#!/usr/bin/env bash
# 一键爬取全部平台热榜
# 依赖: playwright-cli (需已安装并在 PATH 中)
# 用法: bash crawl_all.sh [输出目录]
# 输出: 在指定目录下生成各平台热榜 Markdown 文件

set -euo pipefail

OUTDIR="${1:-.}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$OUTDIR"

echo "🚀 开始爬取全平台热榜..."
echo ""

bash "$SCRIPT_DIR/crawl_douyin.sh" "$OUTDIR/douyin_hot_list.md"
echo ""

bash "$SCRIPT_DIR/crawl_kuaishou.sh" "$OUTDIR/kuaishou_hot_list.md"
echo ""

bash "$SCRIPT_DIR/crawl_bilibili.sh" "$OUTDIR/bilibili_hot_list.md" all game
echo ""

bash "$SCRIPT_DIR/crawl_weibo.sh" "$OUTDIR/weibo_hot_list.md"
echo ""

echo "🎉 全部平台热榜爬取完成！文件保存在: $OUTDIR/"
ls -la "$OUTDIR/"*_hot_list.md 2>/dev/null
