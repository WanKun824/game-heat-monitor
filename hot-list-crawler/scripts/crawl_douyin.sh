#!/usr/bin/env bash
# 爬取抖音热榜 https://www.douyin.com/hot
# 依赖: playwright-cli (需已安装并在 PATH 中)
# 用法: bash crawl_douyin.sh [输出文件路径]
# 输出: Markdown 格式的抖音热榜数据

set -euo pipefail

OUTPUT="${1:-douyin_hot_list.md}"
PCLI="${PLAYWRIGHT_CLI:-playwright-cli}"

echo "🔥 正在爬取抖音热榜..."

# 打开浏览器并导航
$PCLI open https://www.douyin.com/hot --browser=chromium 2>/dev/null

# 等待页面加载
sleep 3

# 提取热榜数据 (JSON)
RAW=$($PCLI eval "(() => {
  const items = document.querySelectorAll('li');
  const hotClass = Array.from(items).find(el => {
    const text = el.textContent.trim();
    return text.match(/万热度/) && !text.includes('http');
  })?.className || '';
  if (!hotClass) return JSON.stringify([]);
  const hotItems = document.querySelectorAll('li.' + hotClass.split(' ')[0]);
  const results = [];
  hotItems.forEach(el => {
    const text = el.textContent.trim();
    const heatMatch = text.match(/([\\.\\d]+万)热度/);
    const heat = heatMatch ? heatMatch[1] : '';
    const titleText = heat ? text.replace(/([\\.\\d]+万)热度/, '').trim() : text.trim();
    const rankMatch = titleText.match(/^(\\d+)/);
    const rank = rankMatch ? rankMatch[1] : '';
    const title = rank ? titleText.replace(/^\\d+/, '').trim() : titleText;
    if (title) results.push({rank: rank || '置顶', title, heat: heat || '-'});
  });
  return JSON.stringify(results);
})()" 2>/dev/null | grep -o '"result":\s*".*"' | head -1)

# 关闭浏览器
$PCLI close 2>/dev/null || true

# 如果未获取到数据，报错退出
if [ -z "$RAW" ]; then
  echo "❌ 未能获取到抖音热榜数据"
  exit 1
fi

# 解析 JSON 并生成 Markdown
TIMESTAMP=$(date "+%Y年%m月%d日 %H:%M")

cat > "$OUTPUT" << HEADER
# 抖音热榜

> 爬取时间：${TIMESTAMP}

| 排名 | 热榜话题 | 热度 |
|:----:|----------|-----:|
HEADER

# 使用 node 解析 JSON 并输出表格行
NODE_BIN="${NODE_BIN:-node}"
$PCLI eval "(() => {
  const items = document.querySelectorAll('li');
  const hotClass = Array.from(items).find(el => {
    const text = el.textContent.trim();
    return text.match(/万热度/) && !text.includes('http');
  })?.className || '';
  if (!hotClass) return '';
  const cls = hotClass.split(' ')[0];
  const hotItems = document.querySelectorAll('li.' + cls);
  const lines = [];
  hotItems.forEach(el => {
    const text = el.textContent.trim();
    const heatMatch = text.match(/([\\.\\d]+万)热度/);
    const heat = heatMatch ? heatMatch[1] : '-';
    const titleText = heat !== '-' ? text.replace(/([\\.\\d]+万)热度/, '').trim() : text.trim();
    const rankMatch = titleText.match(/^(\\d+)/);
    const rank = rankMatch ? rankMatch[1] : '🔥 置顶';
    const title = rankMatch ? titleText.replace(/^\\d+/, '').trim() : titleText;
    if (title) lines.push('| ' + rank + ' | ' + title + ' | ' + heat + ' |');
  });
  return lines.join('\\n');
})()" 2>/dev/null | grep -o '"result":\s*".*"' | head -1 | \
  sed 's/"result":\s*"//;s/"$//' | \
  sed 's/\\n/\n/g' | sed 's/\\"/"/g' >> "$OUTPUT"

echo "✅ 抖音热榜已保存到 $OUTPUT"
