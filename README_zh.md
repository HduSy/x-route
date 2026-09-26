# x-route

<div align="center">

**专为骑行、跑步与户外运动打造的现代化、高性能、本地优先路线规划器。**  
融合 Strava 典雅直观的交互美学与 BRouter 工业级路径与高程精度。  
*如果对你有帮助，点个 star ⭐ 就是对我最大的支持！*

[English](README.md) | [简体中文](README_zh.md)

[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.3-646cff?logo=vite&logoColor=white)](https://vitejs.dev/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![MapLibre](https://img.shields.io/badge/MapLibre_GL-v6-blue?logo=maplibre&logoColor=white)](https://maplibre.org/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

</div>

---

## 🌟 概述

**x-route** 是一款专为骑行者、跑步者和户外探险者设计的现代路线规划工具。无需繁琐的账号注册与登录，所有路线和个人数据均保存在本地浏览器（IndexedDB）中，保障数据隐私与离线体验。

---

## ✨ 核心特性

### 🚴‍♂️ 智能选路与路径规划
- **智能吸附与路网引擎**：基于 GraphHopper 引擎结合 Custom Model 动态加权，融合 BRouter 工业级高程去噪与坡度算法，针对自行车与户外步道深度优化。
- **多运动类型支持**：
  - 🚴 **公路车 (Road)**：优先选择铺装良好的公路、沥青路与自行车专属道。
  - 🚵 **砾石公路 (Gravel)**：兼顾非铺装砂石路段与车流稀少的乡间副路。
  - 🚵‍♂️ **山地越野 (MTB)**：优先单轨小径（Singletrack）、林道与越野地形。
  - 🏃 **跑步**：步行街、人行步道、公园绿道与河滨跑道。
  - 🥾 **徒步**：登山步道与山间小径。
- **多维规划偏好矩阵 (Preferences & Custom Models)**：
  - **路线偏好**：优先热门路线 (`Popular`)、**优先自行车道/绿道 (`Cycle paths`，针对 `highway=cycleway` 强力导向)**、**优先乡村与支路 (`Tertiary roads`，重度避开繁忙主干道)**、直线直连 (`Direct`)；
  - **高程偏好**：自由随行 (`Any`)、**避开爬坡 (`Min elevation`，平缓巡航)**、**爬坡挑战 (`Max elevation`，爬坡专项)**。
- **路面材质占比条与路况统计（Surface Breakdown，对齐 Strava 风格）**：
  - 路由引擎接入 OpenStreetMap `surface` 与 `road_class` 探针，通过测地线距离加权积分统计；
  - 精准识别**铺装路面 (Paved，沥青/混凝土)**、**非铺装路面 (Unpaved，碎石/泥土/沙石)** 与**未知路面**；
  - 底部状态栏嵌入 Strava 经典长条多色胶囊比例条（品牌紫 + 暖金琥珀 + 质感灰），侧边栏支持联动控制与卡片解构。
- **自由画线模式 (Manual Mode)**：
  - 支持在缺少 OSM 矢量路网或需要直线跨越的区域手动绘制直线航线。仅影响新增路段，已有的沿路轨迹不会被重算；
  - **模式感知拖拽**：关闭手动模式后拖动任意节点，自动将相连段恢复为路网循迹，无需删除重建。
- **直观自然的路线交互体系**：
  - 地图任意位置点击即可添加途经点，**支持直接点在既有路线上**（完美支持原路折返与环线闭环）；
  - **3px 黄金阈值懒激活机制**：路线上轻触单击（位移 `< 3px`）立即追加下一途经点；按住不松拖拽（位移 `≥ 3px`）才拉出橡皮筋插入局部中间点；
  - 拖拽已有节点、起点或终点实时重算路线；
  - **框选删除节点 (Lasso Mode)**：按住鼠标框选一片区域，一键批量删除区域内的途经点。
- **全局控制工具**：一键反转路线起点终点、多级撤销 / 重做、清空当前路线、聚焦居中、GPS 当前位置定位。

### 📈 BRouter 级专业海拔剖面与坡度分析
- **Strava 级三级去噪滤波管线**：
  - **物理坡度限幅器**：自动截断由桥梁、隧道和高精度数字高程模型（DEM）网格造成的假性垂直悬崖毛刺；
  - **空间高斯低通平滑**：连续加权卷积滤波，彻底消除 30m DEM 采样走样与等高线台阶波动；
  - **双阈值迟滞爬升锁定（10m 迟滞回线）**：防止长爬坡中的局部轻微起伏产生虚假的累计下降。
- **BRouter 坡度自适应归一化切分算法**：
  - 借鉴 BRouter `geo-data-exchange` 机制，先进行 30m 空间去噪，再依路线总长动态适配最小归一化分段长度（消除 0.0km / 0.1km 等破碎小分段）；
  - 自动归并连续的同等级坡度段，使宏观爬坡、平路与下坡层次分明。
- **11 级标准坡度色彩编码**：
  - 5 级下坡：`< -15%`、`-10 ~ 15%`、`-7 ~ 9%`、`-4 ~ 6%`、`-1 ~ 3%`
  - 平路区间：`0%`（翡翠绿，范围覆盖 `[-1.0%, +1.0%]`）
  - 5 级爬坡：`1-3%`（缓坡）、`4-6%`（中坡）、`7-9%`（陡坡）、`10-15%`（极陡）、`> 15%`（绝望之墙）
- **单调三次样条插值（Monotone Spline）**：采用 Fritsch-Carlson 单调算法，既保证高程走势丝滑连贯，又彻底避免局部极值处的虚假上冲或下陷（Overshoot）。
- **动态垂直视口缩放**：引入 BRouter `_elevationBounds` 算法（动态添加 12% 边距），即便是高原起伏路线也能占满图表核心区域，地势起伏分明直观。
- **精准对齐 Tooltip 悬浮卡片**：下指箭头严丝合缝对齐曲线采样点，清晰展示**距离**、**海拔**、**分段长度**（小于 1km 自动显示为米，否则为公里）和**坡度**。

### 🗺️ 多源底图与图层
- **内置 8 款精美矢量与栅格底图**：
  1. **明亮高对比 (Bright，默认)**：基于 OpenFreeMap 的高清矢量底图，清晰度高，道路对比醒目。
  2. **彩色底图 (Liberty)**：经典 OpenMapTiles 全彩渲染风格。
  3. **浅色浅灰 (Positron)**：低对比极简灰色风格，凸显路网航线。
  4. **深色暗夜 (Dark)**：极客夜间模式，炫酷护眼。
  5. **卫星实景 (Esri Satellite)**：高分辨率全球卫星影像图。
  6. **等高线地形图 (OpenTopoMap)**：含山体阴影与等高线的专业地形底图。
  7. **骑行专属底图 (CyclOSM)**：突出标示自行车道、骑行专属绿道与道路铺装。
  8. **标准矢量 (OpenStreetMap)**：经典 OSM 社区标准瓦片。
- **切换底图无损保留**：切换底图风格时，已规划的航线和节点完整保留，不闪烁不丢失。
- **视角控制**：支持 2D / 3D 俯仰倾斜角一键切换、罗盘点击复位正北方向。

### 🧰 轨迹工具箱与离线路线库
- **实用轨迹工具**：
  - **反转航向**：起点与终点对调；
  - **抽稀精简**：采用 Douglas-Peucker 算法精简轨迹点数量；
  - **折半拆分**：从中点将当前路线一分为二；
  - **闭环成环**：终点自动连回起点形成完整环线。
- **本地个人路线库**：基于 IndexedDB（Dexie.js）持久化存储在本地设备，私密安全，随时载入与就地编辑更新。
- **零登录轻量短链分享 (Route Sharing via Short-Links)**：
  - 基于 Cloudflare Workers 与 KV，一键生成轻量加密短链与分享卡片；
  - 接收方免登录在手机或电脑浏览器中直接秒级打开，完整保留航线、途经点与海拔数据。
- **A4 浏览器专业打印与排版 (`Cmd+P` / `Ctrl+P`)**：
  - 纯净打印布局：自动隐匿导航栏、抽屉及浮动工具栏；
  - 自动最优视野居中 (`fitActiveRoute`)，自适应适配 A4 横版画幅并保留舒适安全边距；
  - WebGL 端到端起终点徽章渲染，从根本上杜绝 DOM 标记漂移（0 像素绝对贴合）；
  - 暗色模式智能省墨反白。
- **专业 GPX 套件 (`@x-route/gpx`)**：
  - 完美支持 GPX 1.1 协议的导入与导出，保留高程、时间戳、心率、踏频、功率、温度与铺装类型扩展；
  - Web Worker 后台异步解析，即使导入数万点大体积 GPX 文件，前端主线程依然 60fps 流畅不卡顿。

### 🌐 国际化与单位制
- **双语支持**：完整支持简体中文与英文，右上角一键无缝切换。
- **双单位体系**：支持公制（`km`、`m`）与英制（`mi`、`ft`）。

---

## 🏗️ 项目架构

本项目采用 pnpm workspace Monorepo 组织代码：

```text
x-route/
├── apps/
│   └── web/                   # 前端单页应用 (React 19 + Vite)
│       ├── src/
│       │   ├── components/    # Strava 风格交互组件、地图视图、弹窗抽屉
│       │   ├── lib/           # MapManager 地图单例、高程数学计算、Dexie 本地库
│       │   ├── store/         # Zustand 状态切片 (选路、选区、国际化)
│       │   └── workers/       # GPX 解析 Web Worker
│       └── package.json
└── packages/
    └── gpx/                   # 高性能 TypeScript GPX 独立工具库
        ├── src/               # 解析器、生成器、测距、几何算法、扩展协议
        └── package.json
```

---

## 🚀 快速上手

### 环境要求
- **Node.js**: `>= 22.0.0`
- **包管理器**: `pnpm >= 10.0.0`

### 安装与启动

1. **克隆代码仓库**：
   ```bash
   git clone https://github.com/HduSy/x-route.git
   cd x-route
   ```

2. **安装项目依赖**：
   ```bash
   pnpm install
   ```

3. **启动本地开发环境**：
   ```bash
   pnpm dev
   ```
   在浏览器中访问 `http://localhost:5173`。

4. **类型检查与构建打包**：
   ```bash
   # 执行全局 TypeScript 类型检查
   pnpm typecheck

   # 生产环境构建
   pnpm build

   # 预览构建产物
   pnpm preview
   ```

---

## 🛠️ 技术选型

| 领域 | 选型 |
|---|---|
| **核心框架** | [React 19](https://react.dev/) + [Vite 8](https://vitejs.dev/) |
| **编程语言** | [TypeScript](https://www.typescriptlang.org/) |
| **样式与交互** | [Tailwind CSS v4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) |
| **矢量地图** | [MapLibre GL JS](https://maplibre.org/) |
| **剖面图表** | [Chart.js](https://www.chartjs.org/) (Monotone 单调插值与自定义 Canvas 分段着色) |
| **本地数据库** | [Dexie.js](https://dexie.org/) (IndexedDB) |
| **状态管理** | [Zustand](https://zustand-demo.pmnd.rs/) + [Immer](https://immerjs.github.io/immer/) |
| **选路引擎** | [GraphHopper](https://www.graphhopper.com/) (Custom Models) + [BRouter](https://brouter.de/) 算法 |
| **边缘基础设施** | [Cloudflare Workers](https://workers.cloudflare.com/) & KV (GeoIP 智能分流、API 代理、短链存储) |
| **地图瓦片源** | [OpenFreeMap](https://openfreemap.org/) / [OpenStreetMap](https://www.openstreetmap.org/) |

---

## 📄 开源协议

本项目采用 **MIT 协议** 开源，详情参见 `LICENSE`。

---

## 🤝 致谢

- [GraphHopper](https://github.com/graphhopper/graphhopper) — 提供高性能图路由引擎、丰富的路面属性探针与极具弹性的 Custom Models。
- [BRouter & BRouter-Web](https://github.com/nrenner/brouter-web) — 在骑行路网算路、坡度切分归一化以及高程算法方面的开创性贡献。
- [MapLibre GL JS](https://maplibre.org/) — 极速且活跃的开源矢量地图渲染库。
- [OpenFreeMap](https://openfreemap.org/) — 提供高可用、免费公共矢量瓦片服务。
- [OpenStreetMap](https://www.openstreetmap.org/) — 提供覆盖全球的开源地理路网数据。
