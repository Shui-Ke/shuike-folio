# Driving Games

低模驾驶混战：自然地形地图上，你开一辆越野车，和蓝、黄、紫三辆人机对手互相碰撞、追逐绕障。
物理碰撞、脱困恢复、昼夜与天气、草和落叶全部实时。

**在线试玩：<https://shui-ke.github.io/shuike-folio/>**

| 操作 | 功能 |
| --- | --- |
| `W / A / S / D` | 驾驶 |
| `Shift` | 加速 |
| `Space` | 跳跃、翻身 |
| 鼠标滚轮 | 调整相机远近 |
| `R` | 重生 |
| `Esc` | 设置 |

相机以固定俯视方向跟随车辆。地址加 `?bots=0#skip` 可切换到单车模式；当前版本是自由混战，还没有计分或淘汰规则。

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
