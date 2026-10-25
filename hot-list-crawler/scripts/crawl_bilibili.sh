#!/usr/bin/env bash
# 爬取B站排行榜 https://www.bilibili.com/v/popular/rank/all
# 依赖: playwright-cli (需已安装并在 PATH 中)
# 用法: bash crawl_bilibili.sh [输出文件路径] [榜单类型...]
#   榜单类型: all(全部,默认) game(游戏) music(音乐) dance(舞蹈) tech(科技) life(生活) food(美食) animal(动物) car(汽车) fashion(时尚) ent(娱乐) movie(影视) origin(原创) rookie(新人)
#   示例: bash crawl_bilibili.sh bilibili.md all game
# 输出: Markdown 格式的B站排行榜数据

set -euo pipefail

OUTPUT="${1:-bilibili_hot_list.md}"
shift || true
CATEGORIES="${@:-all}"
if [ -z "$CATEGORIES" ]; then
  CATEGORIES="all"
fi

PCLI="${PLAYWRIGHT_CLI:-playwright-cli}"

echo "🔥 正在爬取B站排行榜..."

# 类型映射
declare -A CATE_NAMES
CATE_NAMES[all]="全站排行榜（全部）"
CATE_NAMES[game]="游戏排行榜"
CATE_NAMES[music]="音乐排行榜"
CATE_NAMES[dance]="舞蹈排行榜"
CATE_NAMES[tech]="科技排行榜"
CATE_NAMES[life]="生活排行榜"
CATE_NAMES[food]="美食排行榜"
CATE_NAMES[animal]="动物圈排行榜"
CATE_NAMES[car]="汽车排行榜"
CATE_NAMES[fashion]="时尚排行榜"
CATE_NAMES[ent]="娱乐排行榜"
CATE_NAMES[movie]="影视排行榜"
CATE_NAMES[origin]="原创排行榜"
CATE_NAMES[rookie]="新人排行榜"

TIMESTAMP=$(date "+%Y年%m月%d日 %H:%M")

cat > "$OUTPUT" << HEADER
# B站排行榜

> 爬取时间：${TIMESTAMP}
HEADER

$PCLI open https://www.bilibili.com/v/popular/rank/all --browser=chromium 2>/dev/null
sleep 2

FIRST=true
for CATE in $CATEGORIES; do
  CATE_NAME="${CATE_NAMES[$CATE]:-$CATE}"
  echo "  📊 正在爬取: $CATE_NAME ..."

  if [ "$FIRST" = true ]; then
    FIRST=false
  else
    $PCLI goto "https://www.bilibili.com/v/popular/rank/$CATE" 2>/dev/null
    sleep 2
  fi

  if [ "$CATE" != "all" ]; then
    $PCLI goto "https://www.bilibili.com/v/popular/rank/$CATE" 2>/dev/null
    sleep 2
  fi

  cat >> "$OUTPUT" << SECTION

---

## ${CATE_NAME}

| 排名 | 视频标题 | UP主 | 播放量 | 弹幕数 |
|:----:|----------|------|-------:|-------:|
SECTION

  $PCLI eval "(() => {
    const items = document.querySelectorAll('.rank-item');
    const lines = [];
    items.forEach(el => {
      const rank = el.querySelector('.num')?.textContent?.trim() || '';
      const title = (el.querySelector('.title')?.textContent?.trim() || '').replace(/\\|/g, '｜');
      const up = el.querySelector('.up-name')?.textContent?.trim() || '';
      const play = el.querySelector('.detail-state .data-box:nth-child(1)')?.textContent?.trim() || '';
      const danmu = el.querySelector('.detail-state .data-box:nth-child(2)')?.textContent?.trim() || '';
      if (rank && title) lines.push('| ' + rank + ' | ' + title + ' | ' + up + ' | ' + play + ' | ' + danmu + ' |');
    });
    return lines.join('\\n');
  })()" 2>/dev/null | grep -o '"result":\s*".*"' | head -1 | \
    sed 's/"result":\s*"//;s/"$//' | \
    sed 's/\\n/\n/g' | sed 's/\\"/"/g' >> "$OUTPUT"
done

$PCLI close 2>/dev/null || true

echo "✅ B站排行榜已保存到 $OUTPUT"
