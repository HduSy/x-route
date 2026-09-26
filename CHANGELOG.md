# 更新日志 (Changelog)

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/) 规范，记录所有新功能（Features）、体验优化（Improvements）以及问题修复（Bug Fixes）。

---

## [Unreleased]

### ✨ 新增与优化 (Improvements)
- **路线卡片耗时标头排版优化与防折行（对齐 Strava 紧凑规范）**：
  - 在侧边抽屉路线卡片（`MyRoutesDrawer`）中将预估耗时标头精简为 `Est. Time`（中文保持“预估耗时”），字长与 `DISTANCE`、`ASCENT` 形成严格对称，彻底消除英文环境下 16 字符（`EST. MOVING TIME`）在窄网格内被折成两行导致卡片高度参差不齐的问题；
  - 为路线卡片及底部主状态栏（`RouteStatsBar`）的全量指标项增加 `whitespace-nowrap` 与 `shrink-0` 兜底防护，卡片端悬停支持 `title` 展示全称；
- **官方文档同步与技术栈校准**：
  - 同步更新中英文双语 `README.md` 与 `README_zh.md`，完整补全路面材质占比条、多维路线/高程偏好矩阵、3px 懒激活路线交互、短链分享及 A4 浏览器专业打印排版等最新核心功能；
  - 校准技术架构描述，明确以 GraphHopper 为核心路由算路引擎、融合 BRouter 高程与坡度算法，并补充 Cloudflare Workers 边缘计算基础设施。
- **路线上点击与拖拽动静分离优化（支持路线上直接点击添加终点/闭环）**：
  - 核心痛点解决：此前鼠标在路线上只要按下（`pointerdown`）便立即判定为拖拽态并拦截原生事件，导致用户在已有路线上单纯单击想追加新点（如原路折返、环线闭环）时，被强行拦截并原地插入中间节点。
  - 3px 黄金阈值懒激活机制（对齐 MapLibre 官方标准）：
    - **轻触单击（位移 < 3px）**：吸收手指物理微抖，按下时不提前闪现橡皮筋或禁用地图平移；松手时精准派发 `onMapClick`，将路线末端平滑延伸至点击点，支持闭环成环与沿路折返。
    - **按住拖拽（位移 ≥ 3px）**：只有真正拖出位移后才激活拖拽态，实时渲染橡皮筋调整中途路线走向。
- **路面材质占比条与路况统计（Surface Breakdown，对齐 Strava 风格）**：
  - 路由引擎层接入材质探针：在 GraphHopper 路径计算中请求 `details: ['surface', 'road_class']` 属性，精准识别铺装材质（`asphalt`, `concrete`, `paved` 等）与非铺装材质（`gravel`, `dirt`, `ground`, `compacted` 等），并在 OSM 材质缺省时基于高等级路网分类进行智能判定推导。
  - 测地线距离加权测算：在 `surface.ts` 中以测地线距离为权重实时积分统计，确保呈现的百分比真实反映整段路线的物理里程占比。
  - 视觉呈现完美契合 x-route 主题：
    - **底部状态栏 (`RouteStatsBar`)**：紧随预估用时区，嵌入 Strava 经典的多段式圆角胶囊比例条（品牌紫 `#863BFF` 铺装路面 + 暖金琥珀 `#F59E0B` 砂石土路 + 质感灰未知路面），附带微型图例与悬停详细信息。
    - **规划侧边栏 (`RouteBuilderSidebar`)**：在「地图显示选项」中接入专属显隐开关（`showSurfaceType`），并在路线激活时展开直观的路面材质解构卡片。
- **「优先自行车道」与「优先乡村与支路」路线规划偏好 (Cycle paths & Tertiary roads)**：
  - 在路线编辑器侧边栏的路线偏好下拉菜单中拆分新增两个独立专选模式：
    - **优先自行车道 (绿道/专用道) / Cycle paths (`highway=cycleway`)**：基于 GraphHopper Custom Model，严惩非自行车道（0.4）与机动车主干道（0.0 ~ 0.1），强力将路线导向独立绿道与专用非机动车道，适合休闲骑行与亲子慢游。
    - **优先乡村与支路 (避开主干道) / Tertiary roads (`highway=tertiary`)**：重度惩罚 Motorway/Trunk（0.0）、Primary（0.05）与 Secondary（0.2）等繁忙主干道，专注于车流稀疏、路网连贯的乡村小道与城市三级支路，兼顾公路车高速骑行与人车分流安全。
  - 分段缓存隔离与即时重算响应：在 `getSegmentKey` 中将不同的 `routingPreference` 单独编码，切换选项即刻触发针对性重算，各模式缓存互不污染，并与手动直线分段（`manual` mode）无缝兼容。
- **编辑保存弹窗自动回填原路线信息**：
  - 选中已有路线进行编辑后打开保存弹窗时，系统通过 `useLiveQuery` 自动预读并回填原路线的标题（`name`）与描述信息（`desc`），彻底避免原自定义名称及备注被默认的 `Route <Date>` 覆盖重置。
  - 保存流程精准识别当前编辑/选中的已有路线，支持就地更新（in-place update），避免意外生成重复卡片。
- **框选删除图标视觉更新**：
  - 将地图底部悬浮工具栏中的框选/套索模式图标从 `BoxSelect` 替换为指向更明确的带光标虚线框选图标 `SquareDashedMousePointer`。
- **中国大陆访客 GeoIP 边缘智能分流系统**：
  - 在 Cloudflare Worker 边缘层实现按访客地理位置（`request.cf.country === 'CN'`）智能分流，支持无缝 302 重定向至国内域名 `x-route.cn`。
  - 具备严格的生产级防御机制：自动豁免 `/api/*` 接口与静态资源、防止同域名自循环跳转；配置 `ENABLE_CN_REDIRECT` 环境变量安全熔断开关（默认 `false`），在新域名实名核验与服务就绪前不影响线上正常访问。
- **A4 浏览器打印排版优化（第一阶段）**：
  - 触发打印时（`Cmd+P` / `Ctrl+P` / `window.print()`）自动通过 `@media print` 隐藏顶部导航栏、左右侧边抽屉、底部悬浮操作条及地图浮动交互按钮，提供纯净视口。
  - MapLibre WebGL 渲染优化：开启 `canvasContextAttributes.preserveDrawingBuffer: true`，彻底根除打印预览时地图 Canvas 变黑/白屏的底层渲染缺陷。
  - 新增 `usePrintHandler` 钩子：在 `beforeprint` 事件中自适应计算最佳视图边距（`fitActiveRoute`）并重算地图投影尺寸，确保路线在 A4 横版画幅中完整居中呈现且不被裁切；暗黑模式打印时自动智能转为省墨白底样式。

### 🐛 修复 (Bug Fixes)
- **手动模式关闭后再次拖拽节点无法自动循迹的问题**：
  - 根因分析：此前在实现增量手动模式时，为避免已有分段被误重算，在 `moveAnchor` 中写死了原有分段模式（`segmentModes`）保持不变。导致用户在手动模式开启时通过线上拖拽创建的节点（两段为 `manual` 直线），在关闭手动模式后再次去拖动时，依然被锁定为直线段，无法向后端请求道路吸附与循迹。
  - 彻底方案：在 `routing-slice.ts` 的 `moveAnchor` 中接入模式感知——当处于关闭状态（`manualMode === false`）下拖拽任意节点时，将其相连的前后分段模式无缝转换为 `'route'`，重新触发道路自动循迹；同时历史栈完整保留分段变更，支持无损 Undo/Redo。
- **A4 打印时起点绿色圆点及终点图钉漂移脱离路线的问题**：
  - 根因分析：路线折线与里程数字徽章均由 MapLibre 在 WebGL Canvas 内通过着色器直接栅格化绘制，因此无论缩放排版如何变动均保持 100% 绝对咬合；而起点绿色圆点与终点黑白棋盘格图钉此前为外部 HTML DOM Marker 元素（`new Marker()`），依赖浏览器在 `@media print` 阶段通过 CSS `transform: translate(...)` 计算像素投影。当浏览器排版引擎为 A4 横版生成物理打印视口及边距时，DOM 坐标更新机制未及时与 GPU 画布对齐，导致起终点 DOM 图钉出现明显的像素级偏移漂移。
  - 彻底方案（纯 WebGL 端到端绘制）：
    - 在 `routing-layer.ts` 中通过 Canvas 2D 动态生成与原 DOM 样式 1:1 像素级复刻的 2x 高清矢量徽章图片（起点 `x-route-start-badge` 经典 Strava 绿色实心带白边阴影圆点，终点 `x-route-finish-badge` 经典黑白方格旗圆点）。
    - 引入专用的 WebGL 矢量图钉层 `x-route-endpoints-symbol`，直接以路线首末顶点坐标（`points[0]` 与 `points[n-1]`）为锚点在 GPU 渲染管线中同批次绘制，设置 `'icon-allow-overlap': true` 确保始终位于顶层且与路线零距离贴合，从数学与渲染底层彻底消除漂移可能性（0.0000px 偏移）。
    - 在 `index.css` 的 `@media print` 中将所有交互式 HTML DOM Marker（`.x-route-anchor-marker`）全部隐藏，确保屏幕端保留完整鼠标拖拽手柄与微交互，纸质打印端则由 WebGL Canvas 独占纯净且绝对精准的起终点徽章呈现。
- **A4 打印时地图容器高度坍缩为 0、仅残留海拔图的问题**：
  - 根因分析：在打印模式下，`App.tsx` 外层使用了 `print:h-auto` 且子级包含无有效空格的 `print:h-[calc(100vh-65px)]` 语法导致高度规则被浏览器丢弃；内部 `<main>` 使用了 `print:relative` 导致原本依赖 flex 撑开的地图 DOM 容器计算高度瞬间坍缩为 `0px`，使得纸面上仅有具备固定高度的海拔图与状态栏可见。此外，MapLibre 的 `_resizeCanvas()` 在重置 buffer 尺寸时会清空 WebGL 缓冲区，而其默认通过 `requestAnimationFrame` 异步绘制的帧无法在浏览器同步截取打印快照前执行，导致地图内容偶发性白屏。
  - 布局与渲染修复：将主容器调整为 `print:h-full` 与 `flex-1 min-h-0` 结合 `absolute inset-0` 的稳固层级，保证地图视口完美填满除底部状态栏以外的所有纸面空间；在 `@media print` 样式中显式约束 `.maplibregl-canvas-container` 与 `.maplibregl-canvas` 的绝对定位覆盖；并在 `beforeprint` 时追加 `map.redraw()` 强制执行同步绘制，确保 WebGL 画布在打印快照捕捉前已完全着色。
- **A4 打印时路线与点位分离、编辑器句柄杂乱问题**：
  - 根因分析：在打印模式下，`@media print` 对 `.maplibregl-canvas` 的强制拉伸与 `position: relative` 破坏了 MapLibre 原生的绝对像素坐标映射，导致 WebGL Canvas 图像拉伸重排而 DOM Marker 停留在旧屏幕坐标，形成「线在陆地、点漂在海上」的错位分离。
  - 样式重构：移除了对 Canvas 容器的原生绝对定位覆盖，保持 MapLibre 内部 1:1 像素映射；同时在 `@media print` 下隐藏了仅用于在线交互拖拽的中间航点紫色句柄（`.x-route-anchor-via`）、幽灵吸附圆点、拖拽提示标签、GPS定位点以及海拔图表光标，使得纸质打印件仅保留精炼路线、起终点图钉与里程徽章。
  - 打印调度优化：重构了 `usePrintHandler`，在 `beforeprint` 时先执行 `map.resize()` 刷新视口容器尺寸再调用 `fitActiveRoute` 居中路线，并在打印结束后自动恢复原先屏幕视口，确保无缝闭环。
- **分享点击导致路线消失问题**：
  - 移除了分享按钮的 HTML `disabled` 属性（改为基于类名的不可点击态 `pointer-events-none`），彻底根除了浏览器在元素被 `disabled` 时将 click 事件穿透/冒泡到父级卡片 `onToggle` 从而导致路线被静默卸载（Unload）的问题。
  - 为路线卡片的「操作按钮区」和「底部状态栏」添加严格的点击事件冒泡阻断保护（`stopPropagation`），避免卡片局部交互误触发整张卡片的选中/取消选中。
  - 重构了「我的路线」列表的 `fileMap` 响应式查询管线，改用由主键 `fileids` 严格驱动的 `db.files.get(id)` 1对1映射，彻底杜绝因实体内部 `_data.id` 丢失导致路线卡片偶发性空白消失的隐患。

---

## [0.2.0] - 2026-09-24

### ✨ 新增功能 (Features)
- **路线短链分享系统 (Share Route)**：
  - 导出并压缩：利用浏览器原生 `CompressionStream('gzip')` 将路线 GPX 压制后快速发布。
  - 边缘存储与防护：基于 Cloudflare Worker + KV 存储（`ROUTE_SHARES`），配置 **TTL = 1 天 (86400s)** 自动过期释放配额。
  - 匿名接口安全硬化：双重体积限制（压缩包 ≤ 2MB，解压后 ≤ 10MB）防 gzip 炸弹；解压前缀嗅探仅放行合法 GPX/XML 内容。
  - 短链分发与拦截：生成优雅的 6 位 Base62 短链接（如 `/r/aB3xK9`），过期或不存在的短链在边缘自动 302 重定向，不污染 SPA。
- **自动导入与镜头平滑聚焦**：
  - 访问分享链接启动时，前端自动提取 Key，后台拉取解压并无缝复用本地导入管线（入库、去重、创建卡片）。
  - 导入成功后浏览器地址栏平滑洗回首页根路径 `/`，避免用户刷新时重复触发导入。
  - 导入成功后通过 `mapManager.fitToPlannerRoute()` 自动计算视口并平滑飞向路线全貌。
- **全局轻量 Toast 消息通知系统**：
  - 新增轻量级 `Toaster` 响应式弹窗体系，无需第三方重量级组件依赖，自动适配暗黑/明亮主题，提供复制成功、导入成功等实时反馈。

### 🎨 交互与视觉优化 (Improvements)
- **路线卡片布局防误触重构**：
  - 右上角新增「分享」操作按钮（位于「下载」按钮右侧），点击具备动态 Spin 加载态。
  - 将红色的「删除」垃圾桶按钮从右上角迁移至**卡片最下方的状态行最右侧**，与高频的下载/分享操作彻底物理隔离，杜绝手滑误删。
- **自由画线模式图标更新**：
  - 地图左侧工具栏的手动绘制直连图标从曲线 `Spline` 更新为更符合航点直连隐喻的 `Waypoints` 图标。
  - 移除左侧抽屉设置面板中手动模式选项左侧多余的小图标，布局更清爽。
- **本地开发无缝联调体验**：
  - 在 `vite.config.ts` 中配置了本地开发接口代理，支持与 `wrangler dev` 本地模拟的 KV 存储端到端联调测试。

---

## [0.1.0] - 2026-09-24

### ✨ 初始核心特性
- 基于 MapLibre GL 与 BRouter / GraphHopper 引擎的高性能路线规划器。
- 支持自行车、步行等多种运动模式及高程偏好路线计算。
- 本地优先（Offline-First）架构：所有路线保存在本地 IndexedDB（Dexie），支持套索框选删除、原路返回（Return to Start）及 GPX 导入导出。
