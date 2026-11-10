# Driving Games

低模驾驶混战：自然地形地图上，你开一辆越野车，和最多七辆人机对手互相碰撞、追逐绕障。
物理碰撞、道具、脱困恢复、昼夜与天气、草和落叶全部实时；地图面积是初版的两倍，西侧新增一片可行驶浅岸、湖心深约 8 米的湖。

打开页面先进开局设置：车辆颜色（赤红 / 橙焰 / 霜白 / 夜黑 / 品红 / 流金）、人机数量 0–7、难度（简单 / 普通 / 困难 / 极限）、道具分布（关闭 / 稀疏 / 标准 / 密集 / 混乱），选择会写进地址栏，刷新或分享都能保留。

**在线试玩：<https://shui-ke.github.io/shuike-folio/>**

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

相机在 Esc → Camera 里可切两版机位：Chase（默认，镜头在车后、视线沿车头方向）与 Classic（原始固定斜俯视角）；滚轮缩放范围 8–60。被重击击飞时会暂时拉远，结束后恢复。车身完全没入水面会损失一条命，还有命时按 `R` 复活，命用完本局结束；人机损坏后淘汰。人机不在画面内时，屏幕四边会出现与它车漆同色的方向标记。

`game/props.html` 是道具模型预览页（本地对应 `Driving Games/Preview Props.cmd`），截图放在 `Driving Games/previews/`。

## 目录

| 路径 | 说明 |
| --- | --- |
| `Driving Games/` | 游戏源码：`sources/`（驾驶、人机、物理、相机、地图、设置界面）、`static/`（模型、贴图、声音、字体） |
| `game/` | 预构建的静态站点，GitHub Pages 发布这个目录 |
| `shots/` | 封面、桌面 / 手机截图与图标 |
| `.github/workflows/pages.yml` | 推送到 `main` 自动部署到 Pages |

重新构建：在 `Driving Games/` 里 `npm install` 后 `npm run build`，产物在 `dist/`；把 `dist/` 同步到 `game/` 再推送即可。
本机可直接双击 `Driving Games/Play.cmd` 试玩已构建版本。

## 来源与许可

- 代码：MIT，© 2025 Bruno Simon（基于其 [folio-2025](https://github.com/brunosimon/folio-2025)），全文见 [`Driving Games/license.md`](Driving%20Games/license.md)
- 音乐：CC0
- 托管、裁剪与构建调整 by Shuike
