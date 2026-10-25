---
name: hot-list-crawler
description: "多平台热榜爬取工具。支持爬取抖音热榜、快手热榜、B站排行榜、微博热搜榜的实时数据，输出为结构化的 Markdown 表格。当用户需要获取各大平台的热门话题、热搜排行、热榜数据时，应使用此技能。触发关键词包括：爬取热榜、抖音热榜、快手热榜、B站排行榜、微博热搜、热搜爬取、平台热榜、热门话题爬取。"
---

# 热榜爬取工具 (Hot List Crawler)

多平台热榜/热搜数据爬取技能，支持抖音、快手、B站、微博四大平台。

## 前置依赖

此技能依赖 `playwright-cli` 进行浏览器自动化操作。使用前确保已安装：

```bash
# 检查是否已安装
command -v playwright-cli

# 未安装则执行
npm install -g @playwright/cli
playwright-cli install-browser
```

## 支持平台

| 平台 | URL | 脚本 | 数据量 |
|------|-----|------|--------|
| 抖音 | https://www.douyin.com/hot | `scripts/crawl_douyin.sh` | ~50条 |
| 快手 | https://www.kuaishou.com/brilliant | `scripts/crawl_kuaishou.sh` | ~48条 |
| B站 | https://www.bilibili.com/v/popular/rank/{category} | `scripts/crawl_bilibili.sh` | 每榜100条 |
| 微博 | https://s.weibo.com/top/summary | `scripts/crawl_weibo.sh` | 50条 |

## 使用方式

### 方式一：运行脚本

脚本位于 skill 目录的 `scripts/` 下。所有脚本均以 bash 执行，接受输出文件路径作为参数。

```bash
SKILL_DIR="~/.codebuddy/skills/hot-list-crawler"

# 爬取单个平台
bash "$SKILL_DIR/scripts/crawl_douyin.sh" ./douyin_hot.md
bash "$SKILL_DIR/scripts/crawl_kuaishou.sh" ./kuaishou_hot.md
bash "$SKILL_DIR/scripts/crawl_weibo.sh" ./weibo_hot.md

# B站支持多榜单（默认 all，可指定多个）
bash "$SKILL_DIR/scripts/crawl_bilibili.sh" ./bilibili_hot.md all game

# 一键爬取全部平台
bash "$SKILL_DIR/scripts/crawl_all.sh" ./output_dir/
```

### 方式二：使用 playwright-cli 手动爬取

当脚本无法正常运行时（如页面结构变化），按以下步骤手动操作：

1. 打开浏览器并导航到目标页面
2. 使用 `playwright-cli eval` 执行 JavaScript 提取数据
3. 将数据整理为 Markdown 表格

各平台的 DOM 选择器和提取逻辑详见 `references/platform_structure.md`。

## 各平台爬取核心逻辑

### 抖音热榜

```bash
playwright-cli open https://www.douyin.com/hot --browser=chromium
sleep 3
# 热榜 li 元素通过"万热度"文本特征识别（class 名动态变化）
# 提取: 排名、标题、热度
playwright-cli eval "(JS提取代码，见 scripts/crawl_douyin.sh)"
playwright-cli close
```

关键点：抖音的 CSS class 名是动态混淆的，不可硬编码。需通过内容特征（文本含"万热度"）动态识别热榜列表项的 class。

### 快手热榜

```bash
playwright-cli open https://www.kuaishou.com/brilliant --browser=chromium
sleep 3
# 热榜标题在 h5 元素中，热度在相邻元素中
# 需过滤掉页面下方"精彩短视频"推荐区域的 h5
playwright-cli eval "(JS提取代码，见 scripts/crawl_kuaishou.sh)"
playwright-cli close
```

关键点：DOM 中已包含全部热榜数据（虽然页面是轮播展示），无需翻页。过滤逻辑：有"万热度"文本的为热榜条目。

### B站排行榜

```bash
playwright-cli open https://www.bilibili.com/v/popular/rank/all --browser=chromium
sleep 2
# 数据在 .rank-item 中，结构稳定
# 切换榜单：goto 不同 category URL
playwright-cli eval "(JS提取代码，见 scripts/crawl_bilibili.sh)"
# 如需其他榜单
playwright-cli goto https://www.bilibili.com/v/popular/rank/game
playwright-cli eval "(JS提取代码，见 scripts/crawl_bilibili.sh)"
playwright-cli close
```

关键点：B站 DOM 结构稳定，选择器长期不变。支持14个分类榜单，通过 URL 路径切换。

### 微博热搜

```bash
playwright-cli open https://s.weibo.com/top/summary --browser=chromium
sleep 5  # 需等待访客验证自动完成
# 数据在 #pl_top_realtimehot table 中
playwright-cli eval "(JS提取代码，见 scripts/crawl_weibo.sh)"
playwright-cli close
```

关键点：微博未登录时会先跳转到访客验证系统（passport.weibo.com），约3-5秒自动通过后跳回热搜页面。必须等待验证完成后再提取数据。

## 输出格式

所有脚本输出统一的 Markdown 表格格式：

- **抖音/快手/微博**: 排名 | 话题 | 热度 | (标签)
- **B站**: 排名 | 视频标题 | UP主 | 播放量 | 弹幕数

## 故障排查

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 抖音数据为空 | class 名变化 | 用 `eval` 检查 `li` 元素，重新识别热榜 class |
| 微博停在验证页 | 访客验证未完成 | 增加等待时间到 8-10 秒 |
| B站数据不全 | 页面未加载完 | 增加 sleep 时间或滚动页面 |
| 快手混入推荐 | 过滤逻辑失效 | 检查 h5 元素，确认热度文本特征 |
| playwright-cli 未找到 | 未安装或不在 PATH | `npm install -g @playwright/cli` |
