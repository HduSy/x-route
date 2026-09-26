# x-route

<div align="center">

**A modern, high-performance, offline-first route planner for cyclists and runners.**  
Combining the sleek design and fluid UX of Strava with the industrial-grade routing and elevation precision of BRouter.  
*If you find this project helpful, a star ⭐ means the world to me!*

[English](README.md) | [简体中文](README_zh.md)

[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.3-646cff?logo=vite&logoColor=white)](https://vitejs.dev/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![MapLibre](https://img.shields.io/badge/MapLibre_GL-v6-blue?logo=maplibre&logoColor=white)](https://maplibre.org/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

</div>

---

## 🌟 Overview

**x-route** is built for cyclists, runners, and outdoor explorers who demand precise elevation metrics, versatile basemaps, and fluid route creation. Everything runs directly in your browser with zero mandatory account sign-ups, keeping your personal tracks private and stored locally on your device.

---

## ✨ Features

### 🚴‍♂️ Intelligent Route Planning
- **Road Snapping & Routing Engine**: Powered by GraphHopper with custom model weighting and BRouter-grade elevation heuristics for cycling and pedestrian optimization.
- **Multiple Activity Profiles**:
  - 🚴 **Road Bike (Road)**: Prioritizes smooth paved roads and cycling infrastructure.
  - 🚵 **Gravel Bike**: Balances unpaved gravel tracks and quiet secondary roads.
  - 🚵‍♂️ **Mountain Bike (MTB)**: Prioritizes singletracks, dirt paths, and technical terrain.
  - 🏃 **Run**: Foot paths, pedestrian walkways, and parks.
  - 🥾 **Hike**: Hiking trails and elevation-conscious mountain paths.
- **Advanced Routing & Elevation Preferences**:
  - **Routing Preferences**: Popular (community favored paths), **Cycle paths** (prioritizes designated cycleways and greenways via `highway=cycleway`), **Tertiary roads** (favors quiet rural/secondary roads while penalizing busy motorways and trunk roads), and Direct (straight lines).
  - **Elevation Preferences**: Any elevation, **Min elevation** (steep climb avoidance for effortless cruising), and **Max elevation** (hill climb challenge).
- **Surface Type Breakdown (Strava Style)**:
  - Real-time road surface extraction from OpenStreetMap `surface` and `road_class` attributes.
  - Distance-weighted geodesic integration categorizing terrain into **Paved** (asphalt, concrete), **Unpaved** (gravel, dirt, ground), and **Unknown**.
  - Multi-segment rounded capsule proportion bar in the bottom stats bar (`RouteStatsBar`), complete with matching toggle switches and breakdown cards in the sidebar.
- **Manual Mode (Off-Road / Free Drawing)**:
  - Draw direct straight-line connections across areas without mapped OSM roads. Applies only to newly added segments — existing road-following segments are never recomputed.
  - **Mode-Aware Anchor Dragging**: Toggling manual mode off and dragging any waypoint treats it as a normal node, automatically re-routing adjacent segments along the road network.
- **Natural Waypoint & Route Line Interactions**:
  - Click anywhere on the map to add waypoints, **including directly on existing route lines** (enables seamless loop closures and out-and-back extensions).
  - **3px Lazy Drag Activation**: Light click on route lines instantly adds the next waypoint without mid-route interruptions; press and drag (`≥ 3px`) activates rubber-band dragging to insert custom mid-route waypoints.
  - Drag existing waypoints, start, or finish markers to dynamically re-calculate segments.
  - **Lasso Box Selection**: Drag a selection box over the map to batch-delete multiple waypoints at once.
- **Route Controls**: One-click route reversal, multi-step undo/redo, full clear, and quick camera re-centering.

### 📈 BRouter-Grade Elevation & Slope Profile
- **Strava-Grade Noise Filtering**:
  - **Physical Slope Limiter**: Automatically clamps unrealistic elevation spikes caused by bridges, tunnels, and steep digital elevation model (DEM) cliffs.
  - **Spatial Gaussian Low-Pass Filter**: Distance-weighted smoothing eliminates 30m DEM grid Nyquist aliasing and cross-slope contour ripples.
  - **Dual-Threshold Hysteresis Deadband**: Eliminates phantom descent noise during climbs (Strava 10m standard).
- **Adaptive Slope Normalization**:
  - Based on BRouter's `geo-data-exchange` algorithm with 30m noise filtering.
  - Dynamically scales segment granularity based on route distance to prevent choppy, micro-length segments.
  - Coalesces adjacent segments with identical slope categories for macro-level climb and descent clarity.
- **11-Level Gradient Categorization**:
  - Level -5: `< -15%` (Deep Blue)
  - Level -4: `-10 ~ 15%` (Sky Blue)
  - Level -3: `-7 ~ 9%` (Cyan)
  - Level -2: `-4 ~ 6%` (Light Blue)
  - Level -1: `-1 ~ 3%` (Soft Blue)
  - Level 0: `0%` (Emerald Green, flat `[-1.0%, +1.0%]`)
  - Level 1: `1-3%` (Yellow, gentle climb)
  - Level 2: `4-6%` (Amber, moderate climb)
  - Level 3: `7-9%` (Orange, steep climb)
  - Level 4: `10-15%` (Red, very steep)
  - Level 5: `> 15%` (Purple, severe wall)
- **Monotone Cubic Spline Interpolation**: Uses Fritsch-Carlson algorithm (`cubicInterpolationMode: 'monotone'`) to eliminate artificial extreme overshoot ripples.
- **Dynamic Vertical Range Scaling**: Implements BRouter's `_elevationBounds` (12% adaptive viewport padding), ensuring hills and valleys maintain vivid visual amplitude even in high-altitude plateaus.
- **Pinpoint Floating Tooltip**: Interactive cursor arrow strictly points to the sampled curve point and displays **Distance**, **Elevation**, **Segment length** (adaptive `m` or `km`), and **Slope**.

### 🗺️ Multi-Source Basemaps & Heatmaps
- **8 Integrated Vector & Raster Basemaps**:
  1. **Bright (明亮高对比, Default)**: High contrast, clean vector cartography from OpenFreeMap.
  2. **Liberty (彩色底图)**: Rich, full-color OpenMapTiles style.
  3. **Positron (浅色浅灰)**: Minimalist light greyscale theme.
  4. **Dark (深色暗夜)**: Sleek night theme.
  5. **Esri Satellite (卫星实景)**: High-resolution global satellite imagery.
  6. **OpenTopoMap (等高线地形图)**: Traditional topographic contours and hillshading.
  7. **CyclOSM (骑行专属底图)**: Dedicated cycling infrastructure highlighting lanes, tracks, and surfaces.
  8. **OpenStreetMap (标准矢量)**: Classic OSM raster tiles.
- **Persistent Route Retention**: Seamlessly switch basemaps on the fly without losing in-progress routes or active waypoints.
- **View Controls**: Toggle 2D / 3D terrain tilt, compass bearing reset to North, and geolocation auto-focus.

### 🧰 Track Tools & Offline-First Library
- **Track Tools**:
  - **Reverse**: Invert route start and finish.
  - **Simplify**: Douglas-Peucker reduction for optimized track storage.
  - **Split**: Divide a track into two distinct sections at the midpoint.
  - **Loop**: Automatically connect the end point back to the start.
- **Offline-First Route Storage**: Local IndexedDB database powered by Dexie.js. Your routes, names, descriptions, and trackpoints remain entirely on your computer.
- **Zero-Login Route Sharing via Short-Links**:
  - Generate lightweight short URLs powered by Cloudflare Workers and KV.
  - Recipients can open and inspect complete route geometries and elevation profiles on any device with zero sign-up required.
- **Professional A4 Browser Printing & Export (`Cmd+P` / `Ctrl+P`)**:
  - Clean print layout auto-hiding all navigation bars, sidebars, and map controls.
  - Automatic route bounds centering (`fitActiveRoute`) with margin optimization for A4 landscape paper.
  - End-to-end pure WebGL canvas rendering for start/finish badges, eliminating DOM marker drift (0px displacement).
  - Dark-mode smart ink-saver color inversion.
- **GPX Toolkit (`@x-route/gpx`)**:
  - Import and export standard GPX 1.1 format with full elevation, timestamps, heart rate, cadence, power, temperature, and surface metadata.
  - Background Web Worker parsing guarantees zero UI freeze even when processing multi-megabyte GPX tracks.

### 🌐 Localization & Unit Systems
- **Bilingual Interface**: Full support for English and 简体中文 with instant language switching.
- **Dual Unit Systems**: Metric (`km`, `m`) and Imperial (`mi`, `ft`).

---

## 🏗️ Project Architecture

This repository is structured as a pnpm monorepo:

```text
x-route/
├── apps/
│   └── web/                   # Main web application
│       ├── src/
│       │   ├── components/    # Strava UI components, MapView, modals, drawers
│       │   ├── lib/           # MapManager singleton, elevation math, Dexie DB
│       │   ├── store/         # Zustand state stores (routing, selection, i18n)
│       │   └── workers/       # Web Workers for GPX processing
│       └── package.json
└── packages/
    └── gpx/                   # High-performance TypeScript GPX parser & writer
        ├── src/               # Parser, writer, distance, geometry, extensions
        └── package.json
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: `>= 22.0.0`
- **Package Manager**: `pnpm >= 10.0.0`

### Installation & Development

1. **Clone the repository**:
   ```bash
   git clone https://github.com/HduSy/x-route.git
   cd x-route
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

3. **Start the local development server**:
   ```bash
   pnpm dev
   ```
   Open `http://localhost:5173` in your browser.

4. **Typecheck and build for production**:
   ```bash
   # Run TypeScript check across all packages
   pnpm typecheck

   # Build for production
   pnpm build

   # Preview the production build locally
   pnpm preview
   ```

---

## 🛠️ Tech Stack

| Domain | Technology |
|---|---|
| **Framework** | [React 19](https://react.dev/) + [Vite 8](https://vitejs.dev/) |
| **Language** | [TypeScript](https://www.typescriptlang.org/) |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) |
| **Map Rendering** | [MapLibre GL JS](https://maplibre.org/) |
| **Elevation Charts** | [Chart.js](https://www.chartjs.org/) (Monotone Splines & Custom Canvas Segments) |
| **Local Database** | [Dexie.js](https://dexie.org/) (IndexedDB) |
| **State Management** | [Zustand](https://zustand-demo.pmnd.rs/) + [Immer](https://immerjs.github.io/immer/) |
| **Routing Engine** | [GraphHopper](https://www.graphhopper.com/) (Custom Models) + [BRouter](https://brouter.de/) Algorithms |
| **Edge Infrastructure** | [Cloudflare Workers](https://workers.cloudflare.com/) & KV (GeoIP routing, API relay, short links) |
| **Vector Tiles** | [OpenFreeMap](https://openfreemap.org/) / [OpenStreetMap](https://www.openstreetmap.org/) |

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

## 🤝 Acknowledgments

- [GraphHopper](https://github.com/graphhopper/graphhopper) — For its high-performance graph routing, rich surface/road attributes, and flexible Custom Models.
- [BRouter & BRouter-Web](https://github.com/nrenner/brouter-web) — For their pioneering work on cycling routing algorithms, slope normalization, and elevation heuristics.
- [MapLibre GL JS](https://maplibre.org/) — For fast, open-source vector map rendering.
- [OpenFreeMap](https://openfreemap.org/) — For free, high-performance public vector map tiles.
- [OpenStreetMap](https://www.openstreetmap.org/) — For worldwide community map data.
