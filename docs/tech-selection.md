# x-route 技术选型与架构设计文档

> 版本 v1.1 · 2026-09-19
> 状态：核心架构决策已收敛（完成路由中继与状态管理架构深化）
> 前置调研：基于对 `gpx.studio`（MIT）源码的实测分析与 API 抓包验证

---

## 1. 项目背景与定位

x-route 是一个以**路线创建与规划（Route Creation & Planning）**为核心定位、兼具 GPX 轨迹编辑能力的 Web 应用。以开源项目 **gpx.studio**（MIT 协议）为功能与体验蓝本，将其架构从 **SvelteKit 迁移至现代 React 生态**，最终部署于 **Cloudflare Pages**。

**核心定位与目标：**
- **路线创建与智能规划**：用户在地图上点选两点或多点，系统自动吸附道路网络并计算生成骑行/徒步轨迹，支持中间虚拟点拖拽实时改线。
- **全套 GPX 编辑能力**：GPX 导入导出、高度剖面分析、裁切/合并/反向/时间推算、多段管理。
- **沿用成熟路由方案与数据源**：对齐原作者的双路由引擎配置（GraphHopper + BRouter），保留完整 Profile（公路车、山地车、徒步等）、路面材质（surface）及私有道路规避能力。
- **完全自有可控的 React 代码库**：基于现代 React 19 + Vite + TypeScript，便于长期功能定制与商业化拓展。
- **Cloudflare 极简部署**：依托 Cloudflare Pages 与 Pages Functions，实现全球 CDN、零服务器运维与低成本。

**非目标（本期）：**
- 不做账号系统 / 云端数据库同步（沿用 Dexie IndexedDB 本地存储）
- 不做 SSR / 服务端渲染（纯客户端 GIS 应用）
- 不自托管重量级 Java 路由引擎（通过边缘中继复用高可用公共实例与作者集群）

---

## 2. 源项目资产盘点（实测复核修正）

对 `gpx.studio` 源码的深入统计与结构拆解（2026-09 实测）：

| 资产 | 规模 | 框架耦合度 | 迁移策略与工作量评估 |
|------|------|-----------|--------------------|
| `gpx/` 核心库 | 6 个 TS 文件 / 2,757 行 | **零**（仅依赖 fast-xml-parser、immer） | **直接复用**（monorepo 独立 package） |
| **三大核心交互控制器** | **3,076 行 TS** | 中（依赖状态与 MapLibre 命令式 API） | **重点攻坚重构**：<br>1. `file-actions.ts` (1,139 行)：撤销重做与动作栈<br>2. `routing-controls.ts` (1,137 行)：两点规划与拖拽改线<br>3. `gpx-layer.ts` (800 行)：矢量图层高性能绘制 |
| 业务逻辑层其余模块 | ~9.5k 行 TS | 低（纯 TS 算法与辅助计算） | 抽取并按 React / Zustand 模式改造 |
| UI 组件层 | **总计 223 个 Svelte 组件** | — | **分层处理（工作量已修正）**：<br>- **163 个标准 shadcn/ui 原语**（`components/ui/`）：通过 CLI 一键生成 React 版<br>- **约 60 个实际业务组件**（~4.5k 行）：重写为 React 业务组件 |
| 第三方能力库 | MapLibre GL / chart.js / dexie / jszip / file-saver | **无**（纯 DOM/TS 库） | 直接复用 |
| i18n 资源 | ~30 种语言 JSON | 无 | 直接搬运，首发中文 + 英文 |

**外部服务依赖与网络实测事实：**
- **地图底图**：MapTiler 矢量/栅格瓦片（客户端 Public Key + 域名白名单防盗链）。
- **路由计算**：
  - `graphhopper.gpx.studio/route`（POST）：覆盖公路车、山地车、砾石车、徒步等核心出行模式。**实测发现服务端配置了严格 CORS，仅允许 `https://gpx.studio` 来源**，因此必须通过 Cloudflare Pages Function 或本地 Vite 代理进行透明中继。
  - `brouter.de/brouter`（GET）：覆盖水路、铁路及备用骑行模式。**实测开放全局 CORS（`*`）**，可直连或经代理调用。

**许可证合规：** gpx.studio 为 **MIT**，允许二次开发、闭源及商用，仅需在构建产物与源码中保留原作者版权声明（Copyright © Olivier Queneau）。✅

---

## 3. 核心架构决策

### AD-1：React + Vite 纯静态 SPA

**决策：采用 React + Vite 纯静态 SPA。**

**理由：**

1. **应用形态决定架构。** gpx.studio 使用 `adapter-static`，构建产物为纯静态文件——无 SSR、无 API 路由、无数据库。232 个组件全部是客户端地图编辑交互，服务端渲染能力在此场景一个都用不上。

2. **Cloudflare 零适配。** Vite 产物为静态文件，Cloudflare Pages 原生直连，`vite build` → 部署，无任何框架适配层。

3. **演进不受限。** 未来若需服务端能力（API 代理、缓存、鉴权），用 Cloudflare Workers + Hono 增量添加即可，不依赖框架级 SSR。

**否决记录：**
- ~~直接 fork Svelte 版~~：当天可上线、成本最低，但与「自有 React 代码库」的长期目标冲突。若 x-route 定位变为快速验证市场，此路径应重新评估（见 §8）。

### AD-2：状态管理采用 Zustand + Immer（切片模式 + Command 撤销重做）

**决策：Zustand + immer 中间件，按 Domain Slices（领域切片）组织，Undo/Redo 采用 Command 差量模式。**

**架构设计细则：**

1. **统一 Store 与切片划分（Domain Slices Pattern）：**
   ```
   src/store/
   ├── index.ts               # 主 store，聚合 slices，集成 immer、devtools、persist 中间件
   ├── types.ts               # 聚合 RootState 与 Action 类型
   └── slices/
       ├── file-slice.ts      # GPX 文件树、航段、航点数据、元数据
       ├── selection-slice.ts # 选中项（选中的文件/航段/航点 ID 集合）
       ├── routing-slice.ts   # 规划状态：Anchors 锚点数组、Profile、是否吸附
       ├── settings-slice.ts  # 用户偏好（单位制、底图图层、快捷键，持久化到 localStorage）
       └── transient-slice.ts # 瞬态高频数据（鼠标经纬度、图表联动高亮索引）
   ```

2. **支持脱离 React 树的纯 TS 模块访问（Vanilla API）：**
   - 在 MapLibre 事件回调、键盘快捷键、Web Worker 消息等非 React 生命周期内，直接使用 `useAppStore.getState().action()` 与 `useAppStore.subscribe()` 读取和更新状态，零 Hooks 规则限制，不引起额外重渲染。

3. **撤销/重做（Undo / Redo）架构：**
   - **否决纯快照方案（如全量 zundo）**：户外 GPX 文件动辄包含数万个航点，每次移动或插入点若全量深拷贝整个状态树，历史栈将极度消耗内存，导致拖拽卡顿。
   - **采纳差量 Command 模式**：沿用原项目 [`file-actions.ts`](file:///Users/rayonreal/DEV/AI/route/gpx.studio/website/src/lib/logic/file-actions.ts) 的思想，将每个编辑行为抽象为具有 `execute()` 和 `undo()` 的差量 Action（例如只记录被修改的 point index 与前后坐标），由 `ActionHistoryManager` 集中调度，内部调用 Zustand 的 Immer action 实现原子化回滚。

4. **派生数据计算防线：**
   - 轻量聚合指标（总里程、总爬升、总耗时）通过 Selector 提取，组件侧配合 `useShallow` 防止无关字段变更导致无谓重渲染。
   - 重型计算（全航段海拔剖面平滑、RDP 抽稀算法）下放 Web Worker，计算完成后单次写回 Store。

### AD-3：UI 体系采用 shadcn/ui + Tailwind CSS

**决策：shadcn/ui（Radix 原语）+ Tailwind CSS + lucide-react，均使用最新稳定版。**

**理由：**
- 源项目即 Tailwind 4 + shadcn-**svelte**（bits-ui 是 Radix 的 Svelte 移植），类名、设计 token、组件目录结构近乎完全对应。
- 盘点复核证实：223 个 Svelte 组件中，**163 个是标准的基础 UI 原语**（位于 `components/ui/`），在 React 中可通过 `pnpm dlx shadcn@latest add` 一键拉取对应 React 实现，仅需集中精力移植约 60 个真正的地图业务组件。

### AD-4：暂不引入客户端路由库

**决策：Phase 0~4 不引入 React Router 等路由库。** 编辑器为纯单页应用，内部交互全部由工具栏/面板/弹窗承载（与源项目一致），UI 状态不进 URL，一个 `/` 路由足够。

### AD-5：路线规划中继代理与双引擎架构（保持原版同源体验）

**决策：采用「Cloudflare Pages Functions 边缘中继 + 本地 Vite Proxy」方案，双引擎（GraphHopper + BRouter）无缝协同。**

**理由与机制：**
1. **解决 CORS 限制**：实测原作者 `graphhopper.gpx.studio` 配置了跨域限制，前端浏览器直连会被拦截。通过在 `functions/api/route.ts` 搭建服务端中继，无跨域限制且无需独立 VPS。
2. **完整继承原版能力**：
   - 保持原版完整的 Profile（公路车、山地车、砾石车、徒步、摩托等）。
   - 保留原作者定制的路面材质提取（`surface`）、登山/越野难度分级（`sac_scale`/`mtb_scale`）与避开私有道路规则（`custom_model`）。
3. **两级容灾与本地开发**：
   - 本地开发：通过 `vite.config.ts` 的 `server.proxy` 5 行代码实现透明代理。
   - 备用引擎：保留 BRouter（`brouter.de`，实测开放 `Access-Control-Allow-Origin: *`）作为特定 profile（水路/铁路）与故障时的无缝降级备选。

### AD-6：MapLibre 命令式单例架构与 React 边界隔离

**决策：采用命令式 `MapManager` 单例模式管理地图实例，React 仅维护 Canvas 容器，弹窗使用 `createPortal` 挂载。**

**理由与机制：**
1. **避免过度声明式封装**：市面上的 `react-map-gl` 等库在面对复杂的动态 GeoJSON 数据源、实时交互吸附和千级图层绘制时极易产生性能瓶颈和生命周期失控。沿用原版原生 MapLibre GL 封装是性能最优解。
2. **React 18/19 StrictMode 幂等保护**：开发环境下组件双重 mount 不会重复创建 WebGL 上下文，建立严密的 `initMap` 单例守护与销毁逻辑。
3. **弹窗挂载桥接**：MapLibre 的 Popup 原生要求 DOM 节点，通过 `ReactDOM.createPortal` 将 React 弹窗组件挂载至 Popup DOM，确保气泡弹窗内完整继承 i18n 语言上下文与全局主题。
4. **高频动效隔离**：海拔剖面滑动时地图上的指示圆圈（Cursor）、拖拽途经点时的虚线预览，直接通过 MapLibre 的 `Source.setData()` 或 Marker DOM 更新，彻底绕过 React 渲染流水线，稳定保持 60fps。

---

## 4. 技术栈总表

> **版本策略：表中所有依赖一律安装实施当时的最新稳定版本（latest），不锁定文档撰写时的版本号。** 源项目的依赖版本（如 Tailwind 4 / React 19 所在世代）仅作迁移参考，x-route 不沿用旧版。

| 层 | 选型 | 说明 |
|------|------|------|
| 语言 | TypeScript（strict 模式） | 全局强类型约束 |
| UI 框架 | React 19 | 纯客户端渲染 |
| 构建与代理 | Vite | 纯静态构建 + 本地开发反向代理（解决路由 CORS） |
| 状态管理 | Zustand + immer 中间件 | 领域切片模式（Domain Slices）+ Command 撤销重做栈 |
| 样式系统 | Tailwind CSS 4 | 沿用源项目设计 Token |
| 组件库 | shadcn/ui + Radix UI | 163 个原语 CLI 自动生成 + 约 60 个定制业务组件 |
| 图标库 | lucide-react | 原样对齐 |
| 地图引擎 | MapLibre GL JS | 原样复用，采用命令式 `MapManager` 单例驱动 |
| GPX 核心库 | `packages/gpx`（源码引入） | 直接复用，纯 TS 零依赖 |
| 路由引擎 | GraphHopper + BRouter 双引擎 | 生产走 Pages Functions 边缘中继，本地走 Vite 代理 |
| 异步计算 | Web Worker（`gpx.worker.ts`） | 负责大文件 XML 解析、高程平滑与 RDP 抽稀 |
| 数据可视化 | chart.js + chartjs-plugin-zoom | 海拔高度剖面图与交互十字光标 |
| 本地离线存储 | Dexie（IndexedDB） | 原样复用，多文件与航段持久化 |
| 列表拖拽排序 | dnd-kit | 文件列表与图层上下层级拖拽排序 |
| 国际化 | i18next + react-i18next | 搬运源项目语言包，首发中/英双语 |
| 测试框架 | Vitest | 覆盖 GPX 数据结构、几何测距与路由数据转换测试 |
| 部署形态 | Cloudflare Pages + Pages Functions | 静态 CDN 全球加速 + `/api` 边缘中继函数 |

---

## 5. Cloudflare 部署与边缘中继方案

```
[浏览器客户端] 
       │ 
       ▼ fetch('/api/graphhopper/route')
[Cloudflare Pages Functions 边缘中继]
       │ 
       ▼ 服务端转发（绕过浏览器 CORS 防盗链）
[graphhopper.gpx.studio 集群 / brouter.de 公共实例]
```

- **架构组成**：
  - **静态前端**：`pnpm build` 输出至 `dist/`，Cloudflare Pages 原生托管。
  - **边缘中继**：`functions/api/graphhopper/[[path]].ts` 负责透明转发请求至 `https://graphhopper.gpx.studio`，追加统一 CORS 响应头，免去自建 VPS 成本。
- **本地开发无缝对接**：在 `vite.config.ts` 配置 `server.proxy` 转发 `/api/graphhopper`，开发机直通作者集群，体验与线上环境保持完全一致。
- **环境变量配置**：
  - `VITE_MAPTILER_KEY`：客户端公钥，MapTiler 控制台配置域名白名单防盗用。
- **缓存策略**：
  - `dist/assets/*`（带哈希静态资源）：开启 immutable 永久缓存。
  - `index.html`：`no-cache`，确保发版即时生效。SPA fallback 重定向至 `index.html`。

---

## 6. 迁移路线图（分阶段交付）

> 原则：**每个阶段结束都是一个可部署、可体验的增量版本**。先搭脚手架与路由中继，再做规划，最后攻坚复杂编辑工具。

### Phase 0 — 脚手架、测试与代理管道（1 天）
- [ ] pnpm workspace 初始化：`apps/web` + `packages/gpx`
- [ ] Vite + React 19 + Tailwind + shadcn/ui 基础组件初始化
- [ ] 配置 Vitest 单元测试环境，跑通 `packages/gpx` 核心算式单测
- [ ] 配置 Vite 本地 Proxy 与 Cloudflare Pages Function 路由中继原型
- [ ] Cloudflare Pages CI/CD 接入，空壳应用与中继在线验证
- **验收：** 本地与线上均能通过 `/api/graphhopper/route` 成功调通起终点算路。

### Phase 1 — GPX 数据与存储层（1~2 天）
- [ ] `packages/gpx` 接入与类型定义完善
- [ ] 文件导入（GPX/ZIP/FIT 纯解析）、文件列表展示、导出下载
- [ ] 引入 Web Worker：大轨迹 XML 解析与统计指标异步计算
- [ ] Dexie（IndexedDB）本地持久化，断网与刷新防丢
- **验收：** 可导入 10MB+ 大轨迹文件，解析顺畅无卡顿，元数据和高程计算正确。

### Phase 2 — 地图渲染与图层系统（2~3 天）⚠️ 核心基石
- [ ] `MapManager` 单例封装，解决 React StrictMode 双重 mount 幂等性
- [ ] MapTiler 矢量底图渲染与图层切换面板
- [ ] `gpx-layer` 移植：GeoJSON Source 批量渲染轨迹折线、方向箭头、选中断高亮
- [ ] Popup 弹窗通过 `createPortal` 挂载，无缝接入主题与语言
- **验收：** 导入的多条 GPX 轨迹在地图上高保真着色渲染，图层切换响应迅速。

### Phase 3 — 核心：路线创建与智能规划工具（3~4 天）⚠️ 体验灵魂
- [ ] 锚点控制器（Anchors Controller）：地图点选起点、终点 Marker 标记
- [ ] 路由引擎调度：调用中继 API 实时计算公路车/山地车/徒步等 Profile 路径
- [ ] 交互式途经点（Intermediate Anchors）：路线悬停半透明虚点、拖拽改线实时局部规划
- [ ] 撤销重做（Undo/Redo）：接入 Command 模式动作历史栈
- **验收：** 从零在地图上点选两个点生成骑行路线，拖拽中途点改道，并成功导出为标准 GPX。

### Phase 4 — 全套编辑工具链（3~5 天）
- [ ] 剪刀工具（轨迹任意点精确打断、分段）
- [ ] 合并工具（多段/多文件首尾串联吸附）
- [ ] 逆向轨迹、闭合环线、时间/配速推算
- [ ] 海拔图表（Chart.js）：交互式十字游标与地图点位实时双向联动
- [ ] Waypoint 兴趣点编辑与图标选择
- **验收：** 完整对齐 gpx.studio 官方核心编辑能力清单。

### Phase 5 — 国际化、PWA 与收尾（2 天）
- [ ] i18n 多语言系统（首发中文简体 + 英文，词条完整对照）
- [ ] 键盘快捷键（Ctrl+Z 撤销、Ctrl+Y 重做、Delete 删除等）
- [ ] PWA 离线运行（Manifest、Service Worker 静态资源离线缓存）
- [ ] 移动端适配与 Lighthouse 性能审计（目标分 ≥ 90）

**总估算：AI 辅助全职投入约 2~3 周**。

---

## 7. 风险登记与应对策略

| # | 风险 | 等级 | 缓解措施 |
|---|------|------|---------|
| R1 | 地图高频拖拽/悬浮导致 React 重渲染卡顿 | 高 | 建立指令式通道，高频位移直接操作 MapLibre Source/Marker DOM，状态走 `transientSlice` 并隔离组件重渲染。 |
| R2 | 原作者 GraphHopper 实例 CORS 限制与反爬 | 高 | **已解决**：采用 Cloudflare Pages Functions 做边缘反代中继；同时保留 BRouter（开放 CORS）作为无缝降级备源。 |
| R3 | 复杂交互控制器（`routing-controls` 1100+行）重构复杂度超预期 | 中~高 | 拆分为“点选起终点”与“动态拖拽改线”两步走，重点保留原版数学吸附算法，状态读写统一通过 Store Vanilla API 对齐。 |
| R4 | 大文件 GPX（万级航点）阻塞 UI 主线程 | 中 | 在 Phase 1 引入 Web Worker，将 XML 序列化、海拔增益、RDP 抽稀放到后台线程计算。 |
| R5 | MapTiler 免费额度超限 | 低 | 客户端 Key 设置域名白名单防盗；底图服务设计为适配器模式，必要时可切换至 OSM / Carto / 天地图。 |

---

## 8. 备选路径存档

**直接 fork Svelte 版 → Cloudflare Pages**：成本最低（当天上线），MIT 协议允许。当前被否决，因为它与「自有 React 代码库」的长期目标冲突。**但若产品目标变为快速市场验证，应优先重启此路径**，待验证后再决定是否投入迁移。

---

## 9. 待决事项

- [ ] 品牌名 / 域名（影响 Phase 0 的 Pages 项目名与 PWA manifest）
- [ ] 首发语言范围（仅中文？中英双语？）
- [ ] 是否保留源项目的 embedding / 分享链接功能（本期默认砍掉）
- [ ] MapTiler key 注册（谁的名义、额度归属）
