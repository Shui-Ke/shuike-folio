# Folio 2025 · 汽车驾驶场景

Bruno Simon 的 [folio-2025](https://github.com/brunosimon/folio-2025) 里的汽车场景：
开一辆低模车在程序化地形里跑，草、落叶、雨雪、昼夜与风全部实时。

**在线试玩：<https://shui-ke.github.io/shuike-folio/>**

| 操作 | 作用 |
| --- | --- |
| `W A S D` | 驾驶 |
| `Shift` | 加速 |
| `Space` | 跳跃 |
| 鼠标 | 视角 |
| `R` | 重生 |
| `Esc` | 设置 |

## 目录

| 路径 | 说明 |
| --- | --- |
| `game/` | 预构建的静态站点，GitHub Pages 直接发布这个目录（相对路径，可放在任意子路径下） |
| `bruno-original/` | 完整源码（MIT），`npm install --force` 后 `npm run build` 可重新构建 |
| `.github/workflows/pages.yml` | 推送到 `main` 自动部署到 Pages |

`game/` 与 `bruno-original/dist/` 内容一致，只去掉了 `sounds/musics/` 里三首曲子的 `.wav` 源文件
（约 130MB），保留实际加载的 `.mp3`，所以试玩音频不受影响。

## 来源与许可

- 代码：MIT，© 2025 Bruno Simon，全文见 [`bruno-original/license.md`](bruno-original/license.md)
- 音乐：CC0（见 `bruno-original/static/sounds/musics/license.md`）
- 本仓库是对上述开源项目的公开镜像与部署，托管、裁剪与构建脚本调整 by Shuike

原始项目：<https://github.com/brunosimon/folio-2025>
