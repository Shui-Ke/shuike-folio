# Driving Games

[English](#english) · [中文](#中文)

---

## English

**A low-poly driving battle in the browser.** On a natural-terrain island you drive an off-roader against up to seven AI rivals — ram them, chase them, dodge obstacles. Physics collisions, pickups, recovery, day-night cycles, weather, grass and falling leaves all run in real time. The map is twice the original area, with a drivable shallow shore and an eight-metre-deep lake on the west side.

The page opens on a setup screen: paint colour (Crimson / Ember / Frost / Midnight / Magenta / Gold), bot count 0–7, difficulty (Easy / Normal / Hard / Extreme) and item density (Off / Sparse / Standard / Dense / Chaos). The choice is written into the URL, so a refresh or a shared link keeps it.

**Live demo: <https://shui-ke.github.io/shuike-folio/>**

### Controls

| Input | Action |
| --- | --- |
| `W / A / S / D` | Drive |
| `Shift` | Boost |
| `Space` | Jump / self-right |
| `← / →` | Cycle the current item (steering stays on `A / D`) |
| `E` | Use the current item |
| Mouse wheel | Camera distance |
| `R` | Respawn / revive (once on Easy) |
| `Esc` | Settings |

### Notes

In **Esc → Camera** you can switch between **Chase** (default; the camera sits behind the car and looks along its nose) and **Classic** (the original fixed angled view); the wheel zooms from 8 to 60. A heavy hit pulls the camera back for a moment and then it returns. If the body goes fully under water you lose a life; while lives remain, press `R` to respawn, and when they run out the match ends. Bots are eliminated once destroyed. When a bot is off-screen, a triangle in its paint colour appears on the screen edge pointing towards it.

`game/props.html` is the item-model preview page (locally `Driving Games/Preview Props.cmd`); screenshots are in `Driving Games/previews/`.

### Stack

JavaScript with **Three.js** on the WebGPU renderer, falling back to **WebGL2** automatically. Physics is **Rapier** (Rust compiled to WebAssembly). Materials are written in **TSL**, so the same shader source compiles to WGSL or GLSL depending on the backend. Built with **Vite**; deployed as a static site to **GitHub Pages** by **GitHub Actions** — no backend, no database.

### Repository layout

| Path | Contents |
| --- | --- |
| `Driving Games/` | Game source: `sources/` (driving, AI, physics, camera, map, setup UI), `static/` (models, textures, audio, fonts) |
| `game/` | Pre-built static site — this is what GitHub Pages publishes |
| `shots/` | Cover, desktop / mobile screenshots and icons |
| `.github/workflows/pages.yml` | Deploys to Pages on every push to `main` |

Rebuild: run `npm install` then `npm run build` inside `Driving Games/`; the output goes to `dist/`. Copy `dist/` into `game/` and push. You can also double-click `Driving Games/Play.cmd` to play the built version locally.

### Credits and licence

- Code: MIT, © 2025 Bruno Simon, based on [folio-2025](https://github.com/brunosimon/folio-2025) — full text in [`Driving Games/license.md`](Driving%20Games/license.md)
- Music: CC0
- Hosting, trimming and build adjustments by Shuike

---

## 中文

**低模驾驶混战。** 自然地形地图上，你开一辆越野车，和最多七辆人机对手互相碰撞、追逐绕障。物理碰撞、道具、脱困恢复、昼夜与天气、草和落叶全部实时；地图面积是初版的两倍，西侧新增一片可行驶浅岸、湖心深约 8 米的湖。

打开页面先进开局设置：车辆颜色（赤红 / 橙焰 / 霜白 / 夜黑 / 品红 / 流金）、人机数量 0–7、难度（简单 / 普通 / 困难 / 极限）、道具分布（关闭 / 稀疏 / 标准 / 密集 / 混乱），选择会写进地址栏，刷新或分享都能保留。

**在线试玩：<https://shui-ke.github.io/shuike-folio/>**

### 操作

| 操作 | 功能 |
| --- | --- |
| `W / A / S / D` | 驾驶 |
| `Shift` | 加速 |
| `Space` | 跳跃、翻身 |
| `← / →` | 切换当前道具（转向仍用 `A / D`） |
| `E` | 使用当前道具 |
| 鼠标滚轮 | 调整相机远近 |
| `R` | 重生 / 复活（简单模式可用一次） |
| `Esc` | 设置 |

### 说明

相机在 Esc → Camera 里可切两版机位：Chase（默认，镜头在车后、视线沿车头方向）与 Classic（原始固定斜俯视角）；滚轮缩放范围 8–60。被重击击飞时会暂时拉远，结束后恢复。车身完全没入水面会损失一条命，还有命时按 `R` 复活，命用完本局结束；人机损坏后淘汰。人机不在画面内时，屏幕四边会出现与它车漆同色的方向标记。

`game/props.html` 是道具模型预览页（本地对应 `Driving Games/Preview Props.cmd`），截图放在 `Driving Games/previews/`。

### 技术栈

JavaScript + **Three.js**，渲染优先走 WebGPU，不支持时自动回退 **WebGL2**；物理用 **Rapier**（Rust 编译成 WebAssembly）；材质用 **TSL** 编写，同一份代码按后端编译成 WGSL 或 GLSL；**Vite** 构建，**GitHub Actions** 把静态站点发布到 **GitHub Pages**，没有后端和数据库。

### 目录

| 路径 | 说明 |
| --- | --- |
| `Driving Games/` | 游戏源码：`sources/`（驾驶、人机、物理、相机、地图、设置界面）、`static/`（模型、贴图、声音、字体） |
| `game/` | 预构建的静态站点，GitHub Pages 发布这个目录 |
| `shots/` | 封面、桌面 / 手机截图与图标 |
| `.github/workflows/pages.yml` | 推送到 `main` 自动部署到 Pages |

重新构建：在 `Driving Games/` 里 `npm install` 后 `npm run build`，产物在 `dist/`；把 `dist/` 同步到 `game/` 再推送即可。
本机可直接双击 `Driving Games/Play.cmd` 试玩已构建版本。

### 来源与许可

- 代码：MIT，© 2025 Bruno Simon（基于其 [folio-2025](https://github.com/brunosimon/folio-2025)），全文见 [`Driving Games/license.md`](Driving%20Games/license.md)
- 音乐：CC0
- 托管、裁剪与构建调整 by Shuike
