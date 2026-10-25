# 平台热榜页面结构参考

## 抖音热榜

- **URL**: `https://www.douyin.com/hot`
- **页面标题**: 抖音热点榜_抖音热门话题_抖音热门视频大全_抖音
- **数据结构**:
  - 热榜列表项: `li` 元素，class 为动态混淆名（如 `NINGm7vw`），需通过内容特征（含"万热度"文本）识别
  - 区分方式: 热榜 li 的 class 与"热点视频"区域的 li class 不同
  - 置顶条目: 无排名数字和热度值
  - 普通条目: 文本格式为 `{排名}{标题}{热度值}万热度`
- **热度格式**: `1209.5万热度`
- **条目数量**: 约50条
- **注意**: class 名可能随页面更新变化，应动态检测而非硬编码

## 快手热榜

- **URL**: `https://www.kuaishou.com/brilliant`
- **页面标题**: 精彩短视频-快手
- **数据结构**:
  - 热榜区域标题: `h2` 元素，文本为"短视频热榜"
  - 热榜条目标题: `h5` 元素
  - 热度值: 在 h5 的兄弟/父级元素中，文本格式为 `{数字}万热度`
  - 轮播展示: 分8页轮播，但 DOM 中已包含全部数据
- **热度格式**: `1326万热度`
- **条目数量**: 约48-50条
- **注意**: 页面下方还有"精彩短视频"推荐区域的 h5，需过滤（无热度值的非热榜条目）

## B站排行榜

- **URL**: `https://www.bilibili.com/v/popular/rank/{category}`
- **分类路径**:
  - `all` - 全站
  - `game` - 游戏
  - `music` - 音乐
  - `dance` - 舞蹈
  - `tech` - 科技
  - `life` - 生活
  - `food` - 美食
  - `animal` - 动物圈
  - `car` - 汽车
  - `fashion` - 时尚
  - `ent` - 娱乐
  - `movie` - 影视
  - `origin` - 原创
  - `rookie` - 新人
- **页面标题**: 哔哩哔哩排行榜
- **数据结构**:
  - 列表项: `.rank-item`
  - 排名: `.rank-item .num`
  - 标题: `.rank-item .title`
  - UP主: `.rank-item .up-name`
  - 播放量: `.rank-item .detail-state .data-box:nth-child(1)`
  - 弹幕数: `.rank-item .detail-state .data-box:nth-child(2)`
  - 综合得分: `.rank-item .pts .num`（部分榜单有）
- **条目数量**: 每个榜单100条
- **注意**: B站 DOM 结构相对稳定，class 名长期不变

## 微博热搜

- **URL**: `https://s.weibo.com/top/summary`
- **页面标题**: 微博搜索-热搜榜
- **数据结构**:
  - 热搜表格: `#pl_top_realtimehot table tbody tr`
  - 排名: `td.td-01`（第一条为空，代表置顶）
  - 标题: `td.td-02 a`
  - 热度: `td.td-02 span`（可能含分类前缀如"剧集"、"综艺"、"电影"）
  - 标签: `td.td-03 i`（"热"、"新"、"沸"、"爆"等）
- **热度格式**: 纯数字（如 `1070383`），部分前带分类文本（如 `电影 408999`）
- **条目数量**: 50条 + 1条置顶
- **注意**:
  - 未登录状态会先跳转到 `passport.weibo.com/visitor/visitor` 访客验证系统
  - 验证系统会自动完成，约3-5秒后自动跳回热搜页面
  - 需等待跳转完成后再提取数据
