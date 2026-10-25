#!/usr/bin/env bash
# 爬取微博热搜榜 https://s.weibo.com/top/summary
# 依赖: playwright-cli (需已安装并在 PATH 中)
# 用法: bash crawl_weibo.sh [输出文件路径]
# 输出: Markdown 格式的微博热搜数据

set -euo pipefail

OUTPUT="${1:-weibo_hot_list.md}"
PCLI="${PLAYWRIGHT_CLI:-playwright-cli}"

echo "🔥 正在爬取微博热搜榜..."

$PCLI open https://s.weibo.com/top/summary --browser=chromium 2>/dev/null

# 微博有访客验证系统，需等待自动跳转
sleep 5

# 确认是否回到热搜页面，如果还在验证页面再等待
CURRENT_URL=$($PCLI eval "document.URL" 2>/dev/null | grep -o '"result":\s*"[^"]*"' | sed 's/"result":\s*"//;s/"$//')
if echo "$CURRENT_URL" | grep -q "passport"; then
  echo "  ⏳ 等待访客验证..."
  sleep 5
fi

TIMESTAMP=$(date "+%Y年%m月%d日 %H:%M")

cat > "$OUTPUT" << HEADER
# 微博热搜榜

> 爬取时间：${TIMESTAMP}

| 排名 | 热搜话题 | 热度 | 标签 |
|:----:|----------|-----:|:----:|
HEADER

$PCLI eval "(() => {
  const rows = document.querySelectorAll('#pl_top_realtimehot table tbody tr');
  const lines = [];
  rows.forEach((tr, i) => {
    const rankEl = tr.querySelector('td.td-01');
    const rankText = rankEl ? rankEl.textContent.trim() : '';
    const titleEl = tr.querySelector('td.td-02 a');
    const title = titleEl ? titleEl.textContent.trim() : '';
    const hotEl = tr.querySelector('td.td-02 span');
    const hotRaw = hotEl ? hotEl.textContent.trim() : '';
    const tagEl = tr.querySelector('td.td-03 i');
    const tag = tagEl ? tagEl.textContent.trim() : '';
    if (!title) return;
    const rank = rankText || '🔥 置顶';
    const hotMatch = hotRaw.match(/(\\d+)$/);
    const hot = hotMatch ? hotMatch[1] : (hotRaw || '-');
    const category = hotRaw.replace(/\\d+$/, '').trim();
    const fullTag = [category, tag].filter(Boolean).join(' ');
    lines.push('| ' + rank + ' | ' + title + ' | ' + hot + ' | ' + fullTag + ' |');
  });
  return lines.join('\\n');
})()" 2>/dev/null | grep -o '"result":\s*".*"' | head -1 | \
  sed 's/"result":\s*"//;s/"$//' | \
  sed 's/\\n/\n/g' | sed 's/\\"/"/g' >> "$OUTPUT"

$PCLI close 2>/dev/null || true

echo "✅ 微博热搜榜已保存到 $OUTPUT"
