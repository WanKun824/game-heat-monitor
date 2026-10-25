#!/usr/bin/env python3
"""
游戏话题异常增量监测脚本
- 读取各平台话题数据，计算每日增量
- 检测异常增量并打印到控制台（不发送任何外部消息）
"""

import json
import os
import re
from datetime import datetime
from collections import defaultdict

DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'js', 'data.js')

def load_data():
    """从 data.js 提取话题播放数据"""
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        content = f.read()

    # 提取 RAW_DATA 数据块
    match = re.search(r'export const RAW_DATA = \{([^}]+(?:\{[^}]*\}[^}]*)*)\};', content, re.DOTALL)
    if not match:
        print("未找到 RAW_DATA 数据")
        return {}

    raw_block = match.group(0)

    platforms = {}
    platform_names = {
        "douyin": "抖音",
        "kuaishou": "快手",
        "bilibili": "B站",
        "xiaohongshu": "小红书"
    }

    for key, name in platform_names.items():
        # 匹配: douyin: [{ d: '...', t: '...', v: ... }, ...]
        pattern = rf'{key}:\s*\[([^\]]+(?:\[[^\]]*\][^\]]*)*)\]'
        match = re.search(pattern, raw_block, re.DOTALL)
        if not match:
            continue

        records_str = match.group(1)
        records = []
        # 解析每条记录: { d: "2026-04-13", t: "原神", v: 3376.8 }
        items = re.findall(r"\{\s*d:\s*'([^']+)'\s*,\s*t:\s*'([^']+)'\s*,\s*v:\s*([0-9.]+)", records_str)
        for date_str, topic, value_str in items:
            records.append({
                "date": date_str,
                "topic": topic,
                "value": float(value_str)
            })

        if records:
            platforms[key] = {
                "name": name,
                "records": records
            }

    return platforms

def detect_anomalies(platforms, threshold_multiplier=3.0, threshold_rate=0.005):
    """
    检测异常增量
    返回: [(platform_name, topic, anomaly_type, details), ...]
    """
    anomalies = []

    for platform_key, platform_data in platforms.items():
        platform_name = platform_data["name"]
        records = platform_data["records"]

        # 按游戏分组，按日期排序
        game_records = defaultdict(list)
        for rec in records:
            game_records[rec["topic"]].append(rec)

        for topic, recs in game_records.items():
            recs.sort(key=lambda x: x["date"])

            for i in range(1, len(recs)):
                today = recs[i]
                yesterday = recs[i - 1]

                # 必须日期连续
                try:
                    from datetime import datetime, timedelta
                    d1 = datetime.strptime(today["date"], "%Y-%m-%d")
                    d0 = datetime.strptime(yesterday["date"], "%Y-%m-%d")
                    if (d1 - d0).days != 1:
                        continue
                except:
                    continue

                increment = today["value"] - yesterday["value"]

                # 前7日增量计算
                hist_increments = []
                for j in range(max(1, i - 7), i):
                    hist_inc = recs[j]["value"] - recs[j - 1]["value"]
                    hist_increments.append(hist_inc)

                if not hist_increments or all(h == 0 for h in hist_increments):
                    continue

                avg_increment = sum(hist_increments) / len(hist_increments)

                # 类型1: 增量倍数异常
                if avg_increment > 0 and increment > avg_increment * threshold_multiplier:
                    rate = (increment - avg_increment) / avg_increment * 100
                    anomalies.append({
                        "platform": platform_name,
                        "topic": topic,
                        "date": today["date"],
                        "type": "增量倍数",
                        "increment": increment,
                        "avg_increment": avg_increment,
                        "multiplier": increment / avg_increment,
                        "rate": rate
                    })

                # 类型2: 增长率异常 (‰)
                if yesterday["value"] > 0:
                    growth_rate = increment / yesterday["value"]
                    if growth_rate * 1000 >= 5:  # ≥5‰
                        anomalies.append({
                            "platform": platform_name,
                            "topic": topic,
                            "date": today["date"],
                            "type": "增长率",
                            "increment": increment,
                            "growth_rate": growth_rate * 1000,  # ‰
                            "yesterday_value": yesterday["value"]
                        })

    return anomalies

def send_alert(anomalies):
    """把异常增量打印到控制台。"""
    if not anomalies:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 未检测到异常增量")
        return

    # 按平台分组
    by_platform = defaultdict(list)
    for a in anomalies:
        by_platform[a["platform"]].append(a)

    print(f"\n=== 游戏话题异常增量告警 ===")
    print(f"监测时间: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"异常数量: {len(anomalies)} 条（{len(by_platform)} 个平台）")

    for platform_name, items in by_platform.items():
        print(f"\n{platform_name}（{len(items)} 条）")
        for a in items[:5]:  # 每个平台最多显示5条
            if a["type"] == "增量倍数":
                print(f"- {a['topic']} | {a['date']} | 当日增量 {a['increment']:.2f} 亿 | "
                      f"前7日均值 {a['avg_increment']:.2f} 亿 | 倍数 {a['multiplier']:.1f}x")
            else:
                print(f"- {a['topic']} | {a['date']} | 当日增量 {a['increment']:.2f} 亿 | "
                      f"增长率 +{a['growth_rate']:.1f}‰")
        if len(items) > 5:
            print(f"  ... 还有 {len(items) - 5} 条异常")

if __name__ == "__main__":
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 开始监测游戏话题数据...")
    platforms = load_data()
    print(f"已加载 {len(platforms)} 个平台数据")

    anomalies = detect_anomalies(platforms)
    send_alert(anomalies)
