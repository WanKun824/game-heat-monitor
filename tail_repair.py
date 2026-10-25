# -*- coding: utf-8 -*-
"""热度数据「尾部自愈」：口径恢复 → 缺口精确恢复 → 平滑补齐 → 单调化。

处理顺序（仅针对各平台最近 WINDOW_DAYS 天）
------------------------------------------
1) 口径恢复：B站 若当日值 < 前值×0.9，且「当日值 + offset」能落回前值附近，补上 offset。
2) 精确恢复：抓取 Excel 的文件名日期 = 数据日期 + 1 天，据此从 Excel 补齐 data.js 中缺失的 (日期, 话题)。
3) 平滑补齐 / 单调化：仍缺失的 → 用该话题近期环比中位数外推；
   出现回落的 → 抬平到不低于前值×(1+环比中位数)。

用法
----
    python tail_repair.py                    # 预演，不写文件
    python tail_repair.py --apply            # 写入（自动备份到 js/_backup）
"""
from __future__ import annotations

import argparse
import re
import shutil
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

WORK_DIR = Path(__file__).resolve().parent
DATA_JS = WORK_DIR / 'js' / 'data.js'
BACKUP_DIR = WORK_DIR / 'js' / '_backup'

PLATFORMS = ('douyin', 'kuaishou', 'bilibili')
PLAT_CN = {'douyin': '抖音', 'kuaishou': '快手', 'bilibili': 'B站'}
# 抓取 Excel 前缀（文件名日期 = 数据日期 + 1 天）
EXCEL_SRC = {
    'douyin':   (WORK_DIR / 'data', 'douyin_topic'),
    'kuaishou': (WORK_DIR / 'data', 'kuaishou_topic'),
    'bilibili': (WORK_DIR / 'data' / 'bilibili', 'bz_test'),
}

BILI_OFFSET = {
    '原神': 518.99, '王者荣耀': 359.29, '蛋仔派对': 350.82, '我的世界': 222.73,
    '第五人格': 214.76, '光遇': 125.94, '崩坏星穹铁道': 92.99, '和平精英': 85.61,
    '火影忍者手游': 71.63, '逆水寒手游': 64.77, '燕云十六声': 64.15, '超自然行动组': 59.68,
    '暗区突围': 44.95, '穿越火线': 42.91, '金铲铲之战': 33.54, '无畏契约': 21.71,
    'PUBG': 16.53, '使命召唤手游': 15.5, '英雄联盟手游': 15.05, '元梦之星': 14.0,
    '七日世界': 6.14, 'QQ飞车手游': 4.96, '穿越火线手游': 4.85, '无畏契约手游': 1.13,
    '王者荣耀世界': 0.74,
    '绝区零': 5.40, '鸣潮': 1.52, '明日方舟终末地': 0.70, 'DNF手游': 0.43,
    '永劫无间手游': 0.04,
}
NAME_MAP = {'dnf手游': 'DNF手游'}

WINDOW_DAYS = 3          # 处理最近几天
LOOKBACK_DAYS = 30       # 环比中位数回看窗口
MAX_RATE = 0.02          # 外推环比上限
STALE_DAYS = 10          # 话题最近一次有值超过这么多天则不再外推
BILI_DROP_RATIO = 0.9    # 低于前值 90% 视为口径未叠加
BILI_TOLERANCE = 0.06    # 补 offset 后允许的偏差

BLOCK_RE = re.compile(r'^  (\w+):\s*\[')
ROW_RE = re.compile(r"d:\s*'([^']+)',\s*t:\s*'([^']+)',\s*v:\s*(-?[\d.]+)")


def fmt(v: float) -> str:
    """与 data.js 近端风格一致：2 位小数、去尾零、至少保留 1 位小数。"""
    s = f'{round(v, 2):.2f}'.rstrip('0')
    return s + '0' if s.endswith('.') else s


def load():
    lines = DATA_JS.read_text(encoding='utf-8').split('\n')
    rs = next(i for i, l in enumerate(lines) if l.strip() == 'export const RAW_DATA = {')
    re_end = next(i for i in range(rs + 1, len(lines)) if lines[i].strip() == '};')
    ser = defaultdict(lambda: defaultdict(dict))     # plat -> topic -> date -> value
    line_of = defaultdict(lambda: defaultdict(dict))  # plat -> topic -> date -> line idx
    plat = None
    block_end = {}
    for i in range(rs, re_end + 1):
        m = BLOCK_RE.match(lines[i])
        if m:
            plat = m.group(1)
            continue
        if plat and lines[i].strip().startswith(']'):
            block_end[plat] = i
            plat = None
            continue
        m = ROW_RE.search(lines[i])
        if m and plat:
            ser[plat][m.group(2)][m.group(1)] = float(m.group(3))
            line_of[plat][m.group(2)][m.group(1)] = i
    return lines, ser, line_of, block_end, rs, re_end


def group_end_line(line_of: dict, plat: str, date_str: str, block_end: int) -> int | None:
    """某平台内该日期的最后一行行号（用于插入新行）。"""
    hits = [li for t in line_of[plat] for d, li in line_of[plat][t].items() if d == date_str]
    return max(hits) if hits else None


def growth(series: dict, before: str) -> float:
    """该话题在 before 之前、最近 LOOKBACK_DAYS 个有效日环比的中位数。

    series 为「日期 -> 值」的单话题序列。
    """
    ds = sorted(d for d in series if d < before)
    rates = []
    for k in range(1, len(ds)):
        a, b = series[ds[k - 1]], series[ds[k]]
        if a > 0:
            rates.append(b / a - 1.0)
    rates = rates[-LOOKBACK_DAYS:]
    if not rates:
        return 0.0
    return min(max(statistics.median(rates), 0.0), MAX_RATE)


def read_excel_values(plat: str, date_str: str) -> dict:
    """读取「数据日期 = date_str」对应的抓取 Excel：文件名日期为 date_str + 1 天。"""
    directory, prefix = EXCEL_SRC[plat]
    d = datetime.strptime(date_str, '%Y-%m-%d') + timedelta(days=1)
    f = directory / f'{prefix}_{d:%m.%d}.xlsx'
    if not f.exists():
        return {}
    try:
        import pandas as pd
        df = pd.read_excel(f)
    except Exception as e:
        print(f'  [WARN] 读取 {f.name} 失败: {e}')
        return {}
    cols = list(df.columns)
    if len(cols) < 2:
        return {}
    out = {}
    for _, row in df.iterrows():
        name = str(row[cols[0]]).strip()
        name = NAME_MAP.get(name, name)
        v = row[cols[1]]
        try:
            out[name] = round(float(v), 4)
        except (TypeError, ValueError):
            continue
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--window', type=int, default=WINDOW_DAYS)
    args = ap.parse_args()

    lines, ser, line_of, block_end, rs, re_end = load()

    # 文件内日期是否严格递增（决定能否按"日期组末尾"插入新行）
    for p in PLATFORMS:
        seq = [d for t in ser[p] for d in ser[p][t]]
        ordered = sorted(seq, key=lambda d: line_of[p][[t for t in ser[p] if d in ser[p][t]][0]][d])
        monotonic = all(ordered[i] <= ordered[i + 1] for i in range(len(ordered) - 1))
        if not monotonic:
            print(f'[ERR] {p} 的行序不是按日期递增，无法安全插入新行，已中止')
            return 1

    plan = []           # (plat, topic, date, new_value, existed_before, tag)
    for p in PLATFORMS:
        all_dates = sorted({d for t in ser[p] for d in ser[p][t]})
        if not all_dates:
            continue
        window = all_dates[-args.window:]
        print(f'\n{"=" * 96}\n【{PLAT_CN[p]}】窗口 {window[0]} ~ {window[-1]}'
              f'（话题 {len(ser[p])}，当日有值 '
              f'{[(d, sum(1 for t in ser[p] if d in ser[p][t])) for d in window]}）')

        # ① 抓取 Excel 里可精确恢复的值
        excel_vals = {d: read_excel_values(p, d) for d in window}

        for topic in sorted(ser[p]):
            corrected = dict(ser[p][topic])
            for d in window:
                prev_date = max((x for x in corrected if x < d), default=None)
                prev = corrected[prev_date] if prev_date else None
                cur = corrected.get(d)
                src = None

                # ② 精确恢复：Excel 有、data.js 无
                if cur is None and d in excel_vals and topic in excel_vals[d]:
                    cur = excel_vals[d][topic]
                    src = 'excel'

                if cur is None:
                    # ③ 平滑补齐
                    if prev is None or prev_date < (
                            datetime.strptime(d, '%Y-%m-%d') - timedelta(days=STALE_DAYS)
                    ).strftime('%Y-%m-%d'):
                        continue
                    cur = max(round(prev * (1 + growth(corrected, d)), 2), prev)
                    src = 'smooth'
                else:
                    # ① 口径恢复（B站）
                    off = BILI_OFFSET.get(topic) if p == 'bilibili' else None
                    if (off and prev is not None and cur < prev * BILI_DROP_RATIO
                            and abs(cur + off - prev) <= BILI_TOLERANCE * prev):
                        cur = round(cur + off, 2)
                        src = 'offset'
                    # ④ 单调化
                    if prev is not None and cur < prev - 1e-9:
                        cur = max(round(prev * (1 + growth(corrected, d)), 2), prev)
                        src = 'lift'

                if src is None:
                    continue
                existed = d in ser[p][topic]
                if existed and abs(cur - ser[p][topic][d]) < 1e-9:
                    continue
                corrected[d] = cur
                ser[p][topic][d] = cur
                plan.append((p, topic, d, cur, existed, src))

    # ---- 报表 ----
    print(f'\n{"=" * 96}\n处理明细（共 {len(plan)} 处）')
    for p in PLATFORMS:
        sub = [x for x in plan if x[0] == p]
        if not sub:
            continue
        cnt = defaultdict(int)
        for *_, tag in sub:
            cnt[tag] += 1
        print(f'\n【{PLAT_CN[p]}】' + '，'.join(
            f'{ {"excel": "Excel精确恢复", "smooth": "平滑补齐", "offset": "口径恢复", "lift": "单调化抬平"}[k] } {v}'
            for k, v in cnt.items()))
        for _, t, d, v, existed, tag in sorted(sub, key=lambda x: (x[2], x[1])):
            old = '(无)' if not existed else f'{ser[p][t].get(d, 0)}'
            print(f'  {d}  {t:<14} {tag:<7} 新值 {v:<10}')

    if not args.apply:
        print('\n[预演] 未写入。确认后加 --apply')
        return 0

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    bak = BACKUP_DIR / f'data.js.{datetime.now():%Y%m%d_%H%M%S}_tailrepair'
    shutil.copy2(DATA_JS, bak)

    # ---- 改值 ----
    changed = 0
    for p, t, d, v, existed, tag in plan:
        if existed:
            li = line_of[p][t][d]
            lines[li] = re.sub(r'(v:\s*)-?[\d.]+', lambda m: m.group(1) + fmt(v), lines[li], count=1)
            changed += 1

    # ---- 插新行（按行号从大到小插入，避免错位）----
    added = 0
    inserts = []
    for p, t, d, v, existed, tag in plan:
        if existed:
            continue
        end_line = group_end_line(line_of, p, d, block_end[p])
        anchor = end_line if end_line is not None else block_end[p] - 1
        inserts.append((anchor, p, f"    {{ d: '{d}', t: '{t}', v: {fmt(v)} }},"))
    for anchor, p, text in sorted(inserts, key=lambda x: -x[0]):
        lines.insert(anchor + 1, text)
        added += 1

    DATA_JS.write_text('\n'.join(lines), encoding='utf-8')
    print(f'\n已写入：改值 {changed} 处，新增 {added} 行。备份 {bak.relative_to(WORK_DIR)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
