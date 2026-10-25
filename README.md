# 游戏话题热度监测 Dashboard

跨平台短视频游戏话题热度可视化面板，附带可选的本地热榜采集与数据校验脚本。

页面本身是纯静态的：无后端、无 API、无环境变量、无构建步骤。

## 在线访问

**https://wankun824.github.io/game-heat-monitor/**

包含两个页面：

- **话题热度**：游戏话题累计播放量趋势、日增量、统计卡片和排行榜
- **平台热榜**：抖音 / 快手 / B站 / 微博热榜快照，支持按游戏筛选和离线归档回看

## 数据

- `js/data.js`：播放数据，包含 `RAW_DATA`（话题累计播放量）和 `WORK_COUNT`（作品数）
- `hot_list_output/`：2026-10-12 的平台热榜快照，以及 2026-10-11 的游戏热榜离线归档（仅保留游戏相关条目）
- `expected_topics_urls_final.xlsx`：游戏话题与平台链接对照表
- 页面读取的是静态快照，不会自动请求或更新数据

## 本地运行页面

由于使用 ES Modules，需要通过 HTTP 服务器访问：

```bash
python -m http.server 8080
# 浏览器打开 http://localhost:8080
```

## 本地工具（可选）

以下脚本只在本机运行，用于采集公开页面或维护本地数据，不需要 API Key，也不读取环境变量。

### 热榜采集

需要 Node.js 和 Playwright：

```bash
npm install
npx playwright install chromium

npm run crawl         # 采集 5 个平台热榜
npm run crawl:check   # 采集后再做一次数据健康巡检
```

也提供基于 `playwright-cli` 的 `hot-list-crawler/` 技能脚本。

### 话题累计播放量

需要 Python、pandas、openpyxl 和 Selenium：

```bash
pip install -r requirements.txt
python crawl_dk.py
```

### 数据校验与修复

```bash
python check_data_health.py --strict
python check_hotlist_health.py --strict
python tail_repair.py --apply
node refresh_archive_games.js
```

- `check_data_health.py`：检查 `js/data.js` 的日期覆盖、缺口、零值和新鲜度
- `check_hotlist_health.py`：检查热榜条数、`heat` 中位数和滚动基线
- `tail_repair.py`：修复最近几天的数据缺口并做单调化
- `refresh_archive_games.js`：按最新规则重算归档热榜中的游戏识别
- `monitor_game_alert.py`：检测异常增量并打印到控制台

## 目录结构

```text
.
├── index.html                  # 话题热度面板
├── game-hot-list.html          # 平台热榜面板
├── css/style.css
├── js/
│   ├── app.js                  # 应用入口
│   ├── state.js                # 发布-订阅状态管理
│   ├── data.js                 # 播放数据快照
│   ├── components.js           # 筛选栏、日期选择器、游戏选择器
│   ├── charts.js               # Chart.js 图表
│   └── download.js             # 数据 / 热榜导出
├── hot-list-crawler/           # Playwright CLI 热榜采集技能
├── crawl_all_node.js           # 四平台热榜采集（Playwright）
├── crawl_and_check.js          # 采集 + 健康检查
├── crawl_dk.py                 # 抖音 / 快手话题累计播放量（Selenium）
├── check_data_health.py        # 播放数据完整性检查
├── check_hotlist_health.py     # 热榜数据健康检查
├── monitor_game_alert.py       # 异常增量检测
├── tail_repair.py              # 数据修复
├── refresh_archive_games.js    # 归档游戏识别重算
├── expected_topics_urls_final.xlsx
└── hot_list_output/            # 热榜数据快照
```

## 技术栈

- 原生 HTML / CSS / JavaScript（ES Modules）
- [Chart.js 4.4.7](https://www.chartjs.org/) — 图表渲染
- [SheetJS](https://sheetjs.com/) — Excel 导出
- Playwright / Selenium — 本地页面采集

## 说明

- 页面是静态快照，更新数据需要替换 `js/data.js` 或 `hot_list_output/` 后重新提交。
- 仓库不包含 API Key、cookie、webhook 或环境变量配置。
- 采集脚本仅用于本地补数据，不会自动部署或上传到任何服务。
