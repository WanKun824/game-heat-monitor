# -*- coding: utf-8 -*-
"""
data.js 数据完整性巡检。

用法:
    python check_data_health.py            # 巡检并打印报告
    python check_data_health.py --strict   # 有缺口则以退出码 1 结束（可用于阻断部署）

检查项:
  1. WORK_COUNT 块能否解析
  2. 各平台条数 / 日期区间 / 插值占比
  3. 日期 x 关键词 网格缺口（应为满格）
  4. 断档：连续缺失的日期段
  5. 零值异常：某天全部关键词为 0（通常是采集失败）
  6. 数据新鲜度：最新日期距今天数
"""
from __future__ import annotations

import argparse
import io
import os
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

WORK_DIR = Path(__file__).resolve().parent
DATA_JS = WORK_DIR / 'js' / 'data.js'
PLATFORMS = ['douyin', 'kuaishou', 'bilibili', 'xiaohongshu']
CN = {'douyin': '抖音', 'kuaishou': '快手', 'bilibili': 'B站', 'xiaohongshu': '小红书'}
ROW_RE = re.compile(r"\{ d: '([^']+)', t: '([^']+)', v: ([-\d.]+)(, i: 1)? \}")

# 小红书数据源已停更，不参与新鲜度告警
STALE_EXEMPT = {'xiaohongshu'}
FRESH_DAYS = 2

# 各数据集在部分平台天然不存在，不算问题
DATASET_SKIP = {'RAW_DATA': {'xiaohongshu'}}


def load(dataset: str) -> dict[str, list[tuple[str, str, float, bool]]]:
    text = DATA_JS.read_text(encoding='utf-8')
    m = re.search(rf'export const {dataset} = \{{.*?^\}};', text, re.S | re.M)
    if not m:
        print('[FATAL] 未能解析 %s 块' % dataset)
        sys.exit(2)
    block = m.group(0)
    out = {}
    skip = DATASET_SKIP.get(dataset, set())
    for p in PLATFORMS:
        if p in skip:
            continue
        pm = re.search(rf'  {p}:\s*\[(.*?)\n  \],', block, re.S)
        rows = []
        if pm:
            for d, t, v, i in ROW_RE.findall(pm.group(1)):
                rows.append((d, t, float(v), bool(i)))
        out[p] = rows
    return out


def daterange(a: str, b: str) -> list[str]:
    d0 = datetime.strptime(a, '%Y-%m-%d').date()
    d1 = datetime.strptime(b, '%Y-%m-%d').date()
    return [(d0 + timedelta(days=i)).strftime('%Y-%m-%d') for i in range((d1 - d0).days + 1)]


def check_dataset(dataset: str, args) -> list[str]:
    """巡检单个数据集，返回问题列表"""
    data = load(dataset)
    problems: list[str] = []
    today = date.today()

    print('\n' + '#' * 64)
    print('# 数据集: %s' % dataset)
    print('#' * 64)

    for p in PLATFORMS:
        if p not in data:
            continue
        rows = data[p]
        print('\n【%s】' % CN[p])
        if not rows:
            print('  [!] 无数据')
            problems.append(f'{dataset}/{CN[p]} 无数据')
            continue

        days = sorted({r[0] for r in rows})
        terms = sorted({r[1] for r in rows})
        grid = {(r[0], r[1]): r[2] for r in rows}
        n_interp = sum(1 for r in rows if r[3])

        print('  条数 %d ｜ 日期 %d 天 ｜ 关键词 %d 个 ｜ 区间 %s ~ %s'
              % (len(rows), len(days), len(terms), days[0], days[-1]))
        print('  插值 %d 条 (%.1f%%)' % (n_interp, n_interp * 100 / len(rows)))

        # 3. 网格缺口 —— 按关键词归并，便于定位是哪个词缺
        gaps = {}
        for d in days:
            miss = [t for t in terms if (d, t) not in grid]
            if miss:
                gaps[d] = miss
        if gaps:
            total = sum(len(v) for v in gaps.values())
            by_term: dict[str, int] = {}
            for _d, ts in gaps.items():
                for t in ts:
                    by_term[t] = by_term.get(t, 0) + 1
            print('  [!] 网格缺口: %d 天共缺 %d 格' % (len(gaps), total))
            print('      缺失关键词 TOP:')
            for t, n in sorted(by_term.items(), key=lambda x: -x[1])[:6]:
                print('        %-14s 缺 %d 天' % (t, n))
            problems.append(f'{dataset}/{CN[p]} 网格缺 {total} 格')
        else:
            print('  网格完整: %d x %d 满格' % (len(days), len(terms)))

        # 4. 日期断档
        expected = daterange(days[0], days[-1])
        missing_days = [d for d in expected if d not in set(days)]
        if missing_days:
            print('  [!] 缺失日期 %d 天: %s%s'
                  % (len(missing_days), missing_days[:8], ' ...' if len(missing_days) > 8 else ''))
            problems.append(f'{dataset}/{CN[p]} 缺失 {len(missing_days)} 个日期')
        else:
            print('  日期连续无断档')

        # 5. 全零日
        zero_days = []
        for d in days:
            vals = [grid[(d, t)] for t in terms if (d, t) in grid]
            if vals and all(v == 0 for v in vals):
                zero_days.append(d)
        if zero_days:
            print('  [!] 全零日 %d 天（疑采集失败）: %s' % (len(zero_days), zero_days[:8]))
            problems.append(f'{dataset}/{CN[p]} 全零日 {len(zero_days)} 天')

        # 6. 新鲜度
        lag = (today - datetime.strptime(days[-1], '%Y-%m-%d').date()).days
        if p in STALE_EXEMPT:
            print('  最新数据滞后 %d 天（该源已停更，豁免）' % lag)
        elif lag > FRESH_DAYS:
            print('  [!] 最新数据滞后 %d 天' % lag)
            problems.append(f'{dataset}/{CN[p]} 滞后 {lag} 天')
        else:
            print('  数据新鲜（滞后 %d 天）' % lag)

    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--strict', action='store_true', help='发现问题时返回退出码 1')
    ap.add_argument('--dataset', default='all',
                    help='巡检指定数据集: RAW_DATA / WORK_COUNT / all（默认）')
    args = ap.parse_args()

    print('=' * 64)
    print('data.js 数据完整性巡检  %s' % datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    print('=' * 64)

    targets = ['RAW_DATA', 'WORK_COUNT'] if args.dataset == 'all' else [args.dataset]
    problems: list[str] = []
    for ds in targets:
        problems += check_dataset(ds, args)

    print('\n' + '=' * 64)
    if problems:
        print('发现 %d 个问题:' % len(problems))
        for x in problems:
            print('  - %s' % x)
    else:
        print('全部检查通过，无数据缺失。')
    print('=' * 64)

    return 1 if (problems and args.strict) else 0


if __name__ == '__main__':
    sys.exit(main())
