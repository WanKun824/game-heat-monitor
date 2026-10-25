import csv
import random
import json
import pandas as pd
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.service import Service
from datetime import date, datetime, timedelta
import time
import os

# ============ 1. 工具函数 ============
def w2yi(value):
    """万/亿/w -> 亿"""
    value = value.strip()
    if value.endswith('w') or value.endswith('W'):
        return round(float(value.lower().replace('w', '').replace(',', '')) / 10000, 4)
    if value.endswith('万'):
        return round(float(value.replace('万', '').replace(',', '')) / 10000, 4)
    if value.endswith('亿'):
        return round(float(value.replace('亿', '').replace(',', '')), 4)
    return None

# ============ 2. 配置 ============
GAME_LIST = [
    '原神', '元梦之星', '永劫无间手游', '英雄联盟手游', '燕云十六声',
    '无畏契约手游', '无畏契约', '我的世界', '王者荣耀世界', '王者万象棋',
    '王者荣耀', '使命召唤手游', '三角洲行动', '七日世界', '逆战未来',
    '逆水寒手游', '鸣潮', '明日方舟终末地', '洛克王国世界', '绝区零',
    '金铲铲之战', '火影忍者手游', '和平精英', '光遇', '第五人格',
    '蛋仔派对', '穿越火线', '超自然行动组', '崩坏星穹铁道', '暗区突围',
    'QQ飞车手游', 'PUBG', 'dnf手游', '穿越火线手游', '遗忘之海',
    '伊莫'
]

TOPICS = {
    '原神':            {'douyin': 'https://www.douyin.com/hashtag/1634704179146760',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X-L1QFJZWf9Z12h'},
    '元梦之星':        {'douyin': 'https://www.douyin.com/hashtag/1776088043060301',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X5OAkeXjQwno1dL'},
    '永劫无间手游':    {'douyin': 'https://www.douyin.com/hashtag/1708515579895819',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X-4UHcVE27nJrkVz'},
    '异环':            {'douyin': 'https://www.douyin.com/hashtag/1706523447519239',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X4DFbrb8S9GM5YE'},
    '英雄联盟手游':    {'douyin': 'https://www.douyin.com/hashtag/1635751792361484',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X2EYT1wpBjfyWE8'},
    '燕云十六声':      {'douyin': 'https://www.douyin.com/hashtag/1741981808490508',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X-8X8w3lKzwzJ2e8'},
    '无畏契约手游':    {'douyin': 'https://www.douyin.com/hashtag/1689690597284871',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X4nUJW1EETpK17I'},
    '无畏契约':        {'douyin': 'https://www.douyin.com/hashtag/1666206277071965',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X-aJvzXM07dDJNaT'},
    '我的世界':        {'douyin': 'https://www.douyin.com/hashtag/1565910651251713',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X-3V0rBqYdHZpSFw'},
    '王者荣耀世界':    {'douyin': 'https://www.douyin.com/hashtag/1657413472525315',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X-9CWOxBjZ1eQ128'},
    '王者万象棋':      {'douyin': 'https://www.douyin.com/hashtag/1749041956903947',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X-8Y7baFNEyuStHY'},
    '王者荣耀':        {'douyin': 'https://www.douyin.com/hashtag/1764938367505416',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X1I4laflrFdD2iu'},
    '使命召唤手游':    {'douyin': 'https://www.douyin.com/hashtag/1644190586090500',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X-8fKcv6jpfSU1yp'},
    '三角洲行动':      {'douyin': 'https://www.douyin.com/hashtag/1772634867886087',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X1pVXPCENDGu1bG'},
    '七日世界':        {'douyin': 'https://www.douyin.com/hashtag/1772360992339038',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X4x4FoIP7nebPfa'},
    '逆战未来':        {'douyin': 'https://www.douyin.com/hashtag/1786215987391499',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X2nqWHp4MKEHmAU'},
    '逆水寒手游':      {'douyin': 'https://www.douyin.com/hashtag/1664049243571207',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X-6mAgNghZXFdjHh'},
    '鸣潮':            {'douyin': 'https://www.douyin.com/hashtag/1689012300219400',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X3qwPROKlWMa1XN'},
    '明日方舟终末地':  {'douyin': 'https://www.douyin.com/hashtag/1727344801164296',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X8F8O1NogNDv10p'},
    '洛克王国世界':    {'douyin': 'https://www.douyin.com/hashtag/7384366519477618729',     'kuaishou': 'https://m.m.chenzhongtech.com/f/X6ugGZUPb5xt1yR'},
    '绝区零':          {'douyin': 'https://www.douyin.com/hashtag/1721909608644612',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X9TgVKuQcsHp10e'},
    '金铲铲之战':      {'douyin': 'https://www.douyin.com/hashtag/1705003612587012',        'kuaishou': 'https://m.m.chenzhongtech.com/f/XamPyUaZ5Wqv8x1'},
    '火影忍者手游':    {'douyin': 'https://www.douyin.com/hashtag/1575513338603533',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X5dMaLrTTsKYGqi'},
    '和平精英':        {'douyin': 'https://www.douyin.com/hashtag/1632869330219016',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X-93d36wcKRTe1CI'},
    '光遇':            {'douyin': 'https://www.douyin.com/hashtag/1616404902109198',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X-8io8beAVZhPknz'},
    '第五人格':        {'douyin': 'https://www.douyin.com/hashtag/1600720944658436',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X2GTFOHgJKXT2bo'},
    '蛋仔派对':        {'douyin': 'https://www.douyin.com/hashtag/1688689887283214',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X1smSD3ZWaFQ2fG'},
    '穿越火线':        {'douyin': 'https://www.douyin.com/hashtag/1565435575324673',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X2VbhyxLa8ac2e2'},
    '超自然行动组':    {'douyin': 'https://www.douyin.com/hashtag/7455278402720532491',     'kuaishou': 'https://m.m.chenzhongtech.com/f/X-69MtYPRUUZRsh0'},
    '崩坏星穹铁道':    {'douyin': 'https://www.douyin.com/hashtag/1711242902507592',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X-9HwQP1xab4g19J'},
    '暗区突围':        {'douyin': 'https://www.douyin.com/hashtag/1706905852349504',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X8SchZlGqhQy1nJ'},
    'QQ飞车手游':      {'douyin': 'https://www.douyin.com/hashtag/1660781400799246',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X-6c9aymCU9U9UXH'},
    'PUBG':            {'douyin': 'https://www.douyin.com/hashtag/1581684863800334',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X-82J4zSKO9d626N'},
    'dnf手游':         {'douyin': 'https://www.douyin.com/hashtag/1607393942767630',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X9W4Y6xmzLYj27V'},
    '穿越火线手游':    {'douyin': 'https://www.douyin.com/hashtag/1567702223593474',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X-5gRVXR3CYcJDhW'},
    '遗忘之海':        {'douyin': '',                                                       'kuaishou': 'https://m.m.chenzhongtech.com/f/X5h9la2l6xG31cC'},
    '伊莫':            {'douyin': 'https://www.douyin.com/hashtag/1643215747930125',        'kuaishou': 'https://m.m.chenzhongtech.com/f/X-2EJ02PB93RD134'}
}

WORK_DIR = os.path.dirname(os.path.abspath(__file__))
DOUYIN_DIR  = os.path.join(WORK_DIR, 'data')
KUAISHOU_DIR = os.path.join(WORK_DIR, 'data')

# ============ 3. 初始化浏览器 ============
chrome_options = Options()
chrome_options.add_argument('--ignore-certificate-errors')
user_agents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Safari/537.36',
]
chrome_options.add_argument(f'user-agent={random.choice(user_agents)}')

service = Service()
_driver = None


def get_driver():
    """懒加载 Selenium driver，避免 import 时即启动浏览器"""
    global _driver
    if _driver is None:
        _driver = webdriver.Chrome(service=service, options=chrome_options)
    return _driver


# ============ 4. 爬取实现 ============
def crawl_douyin(topics=None, save_excel=True):
    """
    爬取抖音话题累计播放数。
    topics: 指定话题名列表，None 表示全量 TOPICS。
    save_excel: False 时只返回 DataFrame，不写 Excel（用于缺口补跑）。
    """
    topics = list(topics) if topics is not None else list(TOPICS.keys())
    dt = date.today().strftime('%m.%d')
    df = pd.DataFrame(columns=['话题', '累计播放数/亿'])
    errors = []
    d = get_driver()
    for topic in topics:
        urls = TOPICS.get(topic)
        if not urls:
            continue
        url = urls['douyin']
        if not url:
            continue
        for attempt in range(3):
            try:
                d.get(url)
                time.sleep(random.uniform(2, 4))
                html = d.page_source
                import re
                m = re.search(r'\\?"chaName\\?":\\?".*?\\?",\\?"viewCount\\?":(\d+)', html)
                if m:
                    raw_count = float(m.group(1))
                    volume = round(raw_count / 100000000.0, 4)
                    df.loc[len(df)] = [topic, volume]
                    print(f"  [OK] {topic}: {raw_count} -> {volume}亿")
                    break
                else:
                    raise Exception("Failed to find viewCount in HTML")
            except Exception as e:
                if attempt < 2:
                    time.sleep(3 + attempt * 2)
                else:
                    errors.append(topic)
                    print(f"  [ERROR] {topic}: {str(e).split(chr(10))[0][:80]}")
    if save_excel:
        path = os.path.join(DOUYIN_DIR, f'douyin_topic_{dt}.xlsx')
        df.to_excel(path, index=False)
        print(f"\n抖音已保存: {path} | 成功: {len(df)}/{len(topics)}, 失败: {len(errors)}")
    return df

def crawl_kuaishou(topics=None, save_excel=True):
    """
    爬取快手话题累计播放数。
    topics: 指定话题名列表，None 表示全量 TOPICS。
    save_excel: False 时只返回 DataFrame，不写 Excel（用于缺口补跑）。
    """
    topics = list(topics) if topics is not None else list(TOPICS.keys())
    dt = date.today().strftime('%m.%d')
    df = pd.DataFrame(columns=['话题', '累计播放数/亿'])
    errors = []
    d = get_driver()
    # 先打开快手首页建立会话，再爬取话题详情页
    try:
        d.get('https://www.kuaishou.com/')
        time.sleep(random.uniform(2, 4))
        print('  [首页] 快手首页已打开')
    except Exception as e:
        print(f"  [WARN] 打开快手首页失败: {str(e).split(chr(10))[0][:80]}")
    for topic in topics:
        urls = TOPICS.get(topic)
        if not urls:
            continue
        url = urls['kuaishou']
        if not url:
            continue
        for attempt in range(3):
            try:
                d.get(url)
                time.sleep(random.uniform(2, 4))
                el = WebDriverWait(d, 10).until(
                    EC.presence_of_element_located((By.XPATH, '//div[@class="tag-detail flex"]/div[2]'))
                )
                play_text = el.text.replace('次播放', '')
                volume = w2yi(play_text)
                df.loc[len(df)] = [topic, volume]
                print(f"  [OK] {topic}: {play_text} -> {volume}亿")
                break
            except Exception as e:
                if attempt < 2:
                    time.sleep(3 + attempt * 2)
                else:
                    errors.append(topic)
                    print(f"  [ERROR] {topic}: {str(e).split(chr(10))[0][:80]}")
    if save_excel:
        path = os.path.join(KUAISHOU_DIR, f'kuaishou_topic_{dt}.xlsx')
        df.to_excel(path, index=False)
        print(f"\n快手已保存: {path} | 成功: {len(df)}/{len(topics)}, 失败: {len(errors)}")
    return df

def main():
    print("=" * 50)
    print(f"开始自动爬取任务 - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 50)
    try:
        crawl_douyin()
        crawl_kuaishou()
    finally:
        get_driver().quit()
    print("爬取任务完成！")

if __name__ == '__main__':
    main()
