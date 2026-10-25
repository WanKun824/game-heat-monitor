#!/usr/bin/env bash
# 爬取快手热榜 https://www.kuaishou.com/brilliant
# 依赖: playwright-cli (需已安装并在 PATH 中)
# 用法: bash crawl_kuaishou.sh [输出文件路径]
# 输出: Markdown 格式的快手热榜数据

set -euo pipefail

OUTPUT="${1:-kuaishou_hot_list.md}"
PCLI="${PLAYWRIGHT_CLI:-playwright-cli}"

echo "🔥 正在爬取快手热榜..."

$PCLI open https://www.kuaishou.com/brilliant --browser=chromium 2>/dev/null
sleep 3

TIMESTAMP=$(date "+%Y年%m月%d日 %H:%M")

cat > "$OUTPUT" << HEADER
# 快手热榜

> 爬取时间：${TIMESTAMP}

| 排名 | 热榜话题 | 热度 |
|:----:|----------|-----:|
HEADER

# 提取 h5 标签中的热榜数据，过滤掉非热榜内容
$PCLI eval "(() => {
  const items = document.querySelectorAll('h5');
  const lines = [];
  let rank = 0;
  let isTop = true;
  items.forEach(el => {
    const text = el.textContent.trim();
    if (!text || text.length <= 1 || text.includes('精彩') || text.includes('短视频热榜')) return;
    const parent = el.closest('[cursor=pointer]') || el.parentElement;
    let heat = '';
    if (parent) {
      const allTexts = Array.from(parent.querySelectorAll('*')).map(e => e.textContent);
      const heatText = allTexts.find(t => t.includes('万热度'));
      if (heatText) heat = heatText.replace('热度', '').trim();
    }
    if (!heat) {
      if (isTop) {
        lines.push('| 🔥 置顶 | ' + text + ' | - |');
        isTop = false;
      }
      return;
    }
    rank++;
    lines.push('| ' + rank + ' | ' + text + ' | ' + heat + ' |');
  });
  return lines.join('\\n');
})()" 2>/dev/null | grep -o '"result":\s*".*"' | head -1 | \
  sed 's/"result":\s*"//;s/"$//' | \
  sed 's/\\n/\n/g' | sed 's/\\"/"/g' >> "$OUTPUT"

$PCLI close 2>/dev/null || true

echo "✅ 快手热榜已保存到 $OUTPUT"
