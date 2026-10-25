# 游戏话题热度监测 Dashboard

跨平台短视频游戏话题热度可视化面板。纯静态页面，无后端、无 API、无构建步骤。

## 在线访问

**https://wankun824.github.io/game-heat-monitor/**

包含两个页面：

- **话题热度**：游戏话题累计播放量趋势、日增量、统计卡片和排行榜
- **平台热榜**：抖音 / 快手 / B站 / 微博热榜快照，支持按游戏筛选和离线归档回看

## 数据

- `js/data.js`：播放数据，包含 `RAW_DATA`（话题累计播放量）和 `WORK_COUNT`（作品数）
- `hot_list_output/`：2026-10-12 的平台热榜快照，以及 2026-10-11 的离线归档示例
- 数据为静态快照，页面不会自动请求或更新数据

## 本地运行

由于使用 ES Modules，需要通过 HTTP 服务器访问：

```bash
python -m http.server 8080
# 浏览器打开 http://localhost:8080
```

也可以直接打开 `index.html` 查看页面结构，但 ES Modules 和 `fetch` 在 `file://` 下可能受限。

## 目录结构

```text
.
├── index.html              # 话题热度面板
├── game-hot-list.html      # 平台热榜面板
├── css/style.css
├── js/
│   ├── app.js              # 应用入口
│   ├── state.js            # 发布-订阅状态管理
│   ├── data.js             # 播放数据快照
│   ├── components.js       # 筛选栏、日期选择器、游戏选择器
│   ├── charts.js           # Chart.js 图表
│   └── download.js         # 数据 / 热榜导出
└── hot_list_output/        # 热榜数据快照
```

## 技术栈

- 原生 HTML / CSS / JavaScript（ES Modules）
- [Chart.js 4.4.7](https://www.chartjs.org/) — 图表渲染
- [SheetJS](https://sheetjs.com/) — Excel 导出

页面不依赖任何数据接口。把新的数据写进 `js/data.js` 或 `hot_list_output/` 后，重新部署即可更新。
