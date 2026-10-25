# -*- coding: utf-8 -*-
"""
热榜输出健康巡检 —— 防「数据源改版导致的静默失真」

背景：
  平台改版时，抓取通常不会报错，而是返回 0 条，或者静默换成另一种口径的数值。
  例如 2026-09 快手页面改版后，heat 从「热度」(千万级) 变成了「播放量」(十万级)，
  量级差 20 倍却全程无报错；而当时的完整性巡检只看「格子有没有值」，对「值对不对」完全无感，问题因此拖了 15 天才暴露。

  本脚本负责「值是否合理」：
    1. 契约校验：条数下限 / heat 中位数合理区间
    2. 滚动基线：与最近 N 次的中位数比较，偏离超过阈值告警（捕捉缓慢漂移）
    3. 基线维护：把本轮中位数追加到 hotlist_baseline.json

  注：CONTRACT 与 crawl_all_node.js 的 PLATFORM_CONTRACT 保持一致——
     前者负责「写入前拦截」，本脚本负责「事后巡检 + 趋势」。

2026-09-23 降噪与微博误报修复：
  1. 基线收录规则：原为「完全无异常才写入基线」，导致凌晨偏低值永远进不了基线、
     基线被高值独占，之后每天同一时段都误报（自锁偏差）。现改为「契约校验通过
     即收录」，且保留最近 BASELINE_KEEP 次（不再按天去重），使基线能覆盖完整的
     一个昼夜周期。
  2. 漂移比较双模式：'all' 取最近 DRIFT_WINDOW 次；'slot' 只取同一时段
     （±HOUR_TOLERANCE 小时）的样本。微博热度时段性极强（凌晨 3~6 万，
     白天/前夜 18~25 万，相差 4~7 倍），用全量基线必然误报，故微博走 'slot'；
     同时段样本不足时不做比较（宁漏报、不误报）。
  3. 提醒门槛：同一平台连续 ALERT_CONSECUTIVE(=2) 次巡检异常才记录提醒，且同一组
     异常不重复提醒，直到恢复后再次出现。避免每 2 小时刷屏。
  4. 移除「heat 不可解析比例 > 20%」检测：微博热搜每轮都有约 1/4 条目不携带数值
     （广告位 heat 为「-」、剧集位形如「剧集 2009928」），该检测每轮必触发且无信息
     量。中位数只由可解析条目计算，部分缺失不影响其可靠性。
  注意：--strict 的拦截行为未改动，仍是「存在任一异常即返回 1」，与提醒门槛无关。

用法：
  python check_hotlist_health.py                # 巡检并更新基线
  python check_hotlist_health.py --strict       # 有问题时以退出码 1 结束
  python check_hotlist_health.py --dry-run      # 只巡检，不更新基线
  python check_hotlist_health.py --dir <目录>   # 指定输出目录
  python check_hotlist_health.py --reset-alert  # 清空告警连续计数
"""
from __future__ import annotations

import argparse
import io
import json
import re
import statistics
import sys
from datetime import datetime
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

WORK_DIR = Path(__file__).resolve().parent
OUTDIR = WORK_DIR / 'hot_list_output'
BASELINE_FILE = WORK_DIR / 'hotlist_baseline.json'
ALERT_STATE_FILE = WORK_DIR / 'hotlist_alert_state.json'

PLATFORMS = ['douyin', 'kuaishou', 'bilibili', 'bilibili_game', 'weibo']
CN = {'douyin': '抖音', 'kuaishou': '快手', 'bilibili': 'B站全站',
      'bilibili_game': 'B站游戏', 'weibo': '微博'}

# 与 crawl_all_node.js 的 PLATFORM_CONTRACT 保持一致
CONTRACT = {
    'douyin':        {'min': 45, 'median': (3e6, 5e7), 'note': '抖音热榜「热度」值'},
    'kuaishou':      {'min': 40, 'median': (3e6, 5e7), 'note': '快手 visionHotRank hotValue'},
    'bilibili':      {'min': 95, 'median': (2e5, 1e7), 'note': 'B站全站排行播放量'},
    'bilibili_game': {'min': 95, 'median': (5e4, 3e6), 'note': 'B站游戏排行播放量'},
    'weibo':         {'min': 45, 'median': (3e4, 5e6), 'note': '微博热搜数值热度'},
}

BASELINE_KEEP = 120       # 基线保留最近 N 次巡检记录（足以覆盖一个昼夜周期）
DRIFT_WINDOW = 15         # 'all' 模式的比较窗口：最近 N 次
DRIFT_RATIO = 3.0         # 相对基线偏离倍数告警阈值
DRIFT_MODE = {'weibo': 'slot'}   # 强时段性平台走 'slot'（仅与同一时段比较）
DEFAULT_DRIFT_MODE = 'all'
HOUR_TOLERANCE = 2        # 'slot' 模式时段容差（小时）
MIN_DRIFT_SAMPLES = 3     # 漂移比较所需最少样本数，不足则不比较（宁漏报不误报）

ALERT_CONSECUTIVE = 2     # 同一平台连续 N 次巡检异常才提醒

HEAT_RE = re.compile(r'^([\d.]+)\s*(亿|万)?')

def heat_to_number(heat):
    """'1346.5万' / '1169318' / '1.2亿' -> 数值；无法解析返回 None"""
    if heat is None:
        return None
    s = str(heat).replace(',', '').strip()
    m = HEAT_RE.match(s)
    if not m:
        return None
    v = float(m.group(1))
    unit = m.group(2)
    if unit == '亿':
        v *= 1e8
    elif unit == '万':
        v *= 1e4
    return v


def load_baseline() -> dict:
    if BASELINE_FILE.exists():
        try:
            return json.loads(BASELINE_FILE.read_text(encoding='utf-8'))
        except Exception:
            pass
    return {'platforms': {}}


def load_state() -> dict:
    """告警状态：记录各平台连续异常次数、上次已提醒的异常集合"""
    if ALERT_STATE_FILE.exists():
        try:
            return json.loads(ALERT_STATE_FILE.read_text(encoding='utf-8'))
        except Exception:
            pass
    return {'platforms': {}}


def save_state(state: dict) -> None:
    try:
        ALERT_STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2),
                                    encoding='utf-8')
    except Exception as e:
        print(f'[告警] 状态写入失败: {e}')


def entry_hour(entry: dict):
    """从基线记录取小时；兼容只有 checkedAt 的旧记录"""
    h = entry.get('hour')
    if isinstance(h, int):
        return h
    m = re.search(r'T(\d{2}):', str(entry.get('checkedAt') or ''))
    return int(m.group(1)) if m else None


def hour_distance(a: int, b: int) -> int:
    d = abs(a - b)
    return min(d, 24 - d)


def pick_drift_samples(history: list, mode: str, now_hour: int) -> list:
    """按平台策略挑选用于漂移比较的基线样本（入参按时间正序）"""
    if mode == 'slot':
        out = []
        for h in history:
            eh = entry_hour(h)
            if eh is not None and hour_distance(eh, now_hour) <= HOUR_TOLERANCE:
                out.append(h)
        return out
    return history[-DRIFT_WINDOW:]


def fmt_num(v):
    return '-' if v is None else f'{v:,.0f}'


def check_platform(prefix, items, history, now_hour):
    """返回 (契约问题, 漂移问题, heat中位数, 条数, 偏离倍数, 参与比较的样本数)"""
    contract_problems = []
    drift_problems = []
    n = len(items)
    vals = [v for v in (heat_to_number(i.get('heat')) for i in items) if v is not None]
    med = statistics.median(vals) if vals else None
    c = CONTRACT.get(prefix)

    if c:
        if n < c['min']:
            contract_problems.append(f'条数 {n} 低于下限 {c["min"]}（疑似抓取失败或页面改版）')
        lo, hi = c['median']
        if med is None:
            contract_problems.append('没有任何可解析的 heat 数值')
        elif not (lo <= med <= hi):
            contract_problems.append(
                f'heat 中位数 {fmt_num(med)} 越出合理区间 [{fmt_num(lo)}, {fmt_num(hi)}]'
                f'（口径疑似已变更，此处应为「{c["note"]}」）'
            )

    drift = None
    mode = DRIFT_MODE.get(prefix, DEFAULT_DRIFT_MODE)
    samples = [s for s in pick_drift_samples(history, mode, now_hour) if s.get('median')]
    used = len(samples)
    if med and used >= MIN_DRIFT_SAMPLES:
        base = statistics.median([s['median'] for s in samples])
        if base:
            drift = med / base
            if drift > DRIFT_RATIO or drift < 1 / DRIFT_RATIO:
                scope = f'近 {used} 次同时段基线' if mode == 'slot' else f'近 {used} 次基线'
                drift_problems.append(
                    f'heat 中位数相对{scope} {fmt_num(base)} 偏离 {drift:.2f} 倍'
                )
    return contract_problems, drift_problems, med, n, drift, used


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--strict', action='store_true', help='有异常时返回退出码 1')
    ap.add_argument('--dry-run', action='store_true', help='只巡检，不更新基线')
    ap.add_argument('--dir', default=str(OUTDIR), help='热榜输出目录')
    ap.add_argument('--reset-alert', action='store_true', help='清空告警连续计数')
    args = ap.parse_args()

    if args.reset_alert:
        save_state({'platforms': {}})
        print('告警连续计数已清空。')

    outdir = Path(args.dir)
    baseline = load_baseline()
    state = load_state()
    now = datetime.now()
    today = now.strftime('%Y-%m-%d')
    now_hour = now.hour

    print('=' * 74)
    print(f'热榜输出健康巡检  {now.strftime("%Y-%m-%d %H:%M:%S")}')
    print(f'目录: {outdir}')
    print('=' * 74)
    print(f'{"平台":<8}{"条数":>6}{"heat中位":>14}{"合理区间":>26}{"偏离":>9}{"样本":>6}  结论')
    print('-' * 74)

    all_problems = []    # 全部异常（决定 --strict 退出码）
    fired = []           # 本次达到提醒门槛、需要记录的异常

    for p in PLATFORMS:
        f = outdir / f'{p}_hot_list.json'
        prev = state.get('platforms', {}).get(p, {})
        items, err = None, None
        if not f.exists():
            err = f'输出文件缺失 {f.name}'
        else:
            try:
                items = (json.loads(f.read_text(encoding='utf-8')).get('items')) or []
            except Exception as e:
                err = f'JSON 解析失败 {e}'

        if err:
            cprobs, probs, med, n, drift, used = [err], [err], None, None, None, 0
        else:
            history = baseline.get('platforms', {}).get(p, [])
            cprobs, dprobs, med, n, drift, used = check_platform(p, items, history, now_hour)
            probs = cprobs + dprobs

        c = CONTRACT.get(p, {})
        lo, hi = c.get('median', (None, None))
        rng = f'[{fmt_num(lo)}, {fmt_num(hi)}]' if lo else '-'
        drift_s = f'{drift:.2f}x' if drift else '-'
        n_s = '-' if n is None else str(n)
        print(f'{CN[p]:<8}{n_s:>6}{fmt_num(med):>14}{rng:>26}{drift_s:>9}{used:>6}  '
              + ('OK' if not probs else f'{len(probs)} 项异常'))
        for x in probs:
            print(f'{"":<8}  [!] {x}')

        # 基线收录：契约校验通过即写入（不再要求漂移校验也通过），只保留最近 N 次
        if med and not cprobs and not args.dry_run:
            hist = baseline.setdefault('platforms', {}).setdefault(p, [])
            hist.append({'date': today, 'hour': now_hour, 'median': med, 'n': n,
                         'checkedAt': now.isoformat(timespec='seconds')})
            baseline['platforms'][p] = hist[-BASELINE_KEEP:]

        if probs:
            all_problems += [f'{CN[p]}: {x}' for x in probs]
            streak = int(prev.get('streak', 0)) + 1
            rec = {'streak': streak, 'problems': probs, 'median': med,
                   'lastSeen': now.isoformat(timespec='seconds')}
            # 连续 N 次异常才提醒；同一组异常不重复提醒，直到恢复后再次出现
            if streak >= ALERT_CONSECUTIVE and prev.get('pushedProblems') != probs:
                fired += [f'{CN[p]}: {x}' for x in probs]
                rec['pushedProblems'] = probs
            elif prev.get('pushedProblems'):
                rec['pushedProblems'] = prev['pushedProblems']
            state.setdefault('platforms', {})[p] = rec
        else:
            # 恢复正常：连续计数与已提醒记录一并清零
            state.get('platforms', {}).pop(p, None)

    print('-' * 74)
    if all_problems:
        print(f'发现 {len(all_problems)} 项异常：')
        for x in all_problems:
            print(f'  - {x}')
        print('\n提示：若确认是平台页面改版，请先修正回正确口径再重跑抓取；')
        print('     勿直接沿用异常数据，否则会污染历史趋势与归档。')
    else:
        print('全部平台通过契约校验，heat 量级正常。')

    if not args.dry_run:
        BASELINE_FILE.write_text(json.dumps(baseline, ensure_ascii=False, indent=2),
                                 encoding='utf-8')
        save_state(state)
        print(f'基线已更新: {BASELINE_FILE.name}（各平台保留最近 {BASELINE_KEEP} 次）')

    if fired:
        print(f'[提醒] 达到提醒门槛：' + '；'.join(fired))
    elif all_problems:
        print(f'[提醒] 共 {len(all_problems)} 项异常，但未达提醒门槛'
              f'（不足连续 {ALERT_CONSECUTIVE} 次，或与上次已提醒内容相同）')
    else:
        print('[提醒] 无异常')

    print('=' * 74)
    return 1 if (all_problems and args.strict) else 0


if __name__ == '__main__':
    sys.exit(main())
