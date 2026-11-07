# Shuike · 低模特效实验

WebGPU / TSL 的低模场景实验：模型能有多寒酸，画面就能有多依赖着色器。

![Shuike Look](shuike-look/docs/look-full.png)

| 目录 | 内容 |
| --- | --- |
| [`shuike-look/`](shuike-look/) | 我的复现 demo。零依赖，仓库内自带 three.js 与静态服务器，`node serve.mjs . 4181` 即可运行（Windows 可双击 `Play.cmd`） |
| [`bruno-original/`](bruno-original/) | Bruno Simon 的 [folio-2025](https://github.com/brunosimon/folio-2025) 原始源码，保留下来做逐文件对照（MIT） |

## 这个 demo 在讲什么

同一个场景，把草、树冠卡片、雨、落叶四层特效全部关掉，只剩“一根柱子 + 几个球”的模型；
打开之后观感立刻成立。四层全部是单个 Mesh / 单次 draw call：

- 草：129,600 根 × 3 顶点，形状、朝向、风都在顶点着色器里
- 树冠：每棵树 80 张 alpha 卡片 + 128×128 SDF 贴图
- 雨 / 雪：一个 Mesh，位置全在 0..1 盒子里循环
- 落叶：GPU compute 粒子，position / velocity 两个 buffer，CPU 回退跑同一组方程
- 光照：一盏方向光 + 手写三段式着色（受光 / 紫影 / 地面反弹）

细节见 [`shuike-look/README.md`](shuike-look/README.md)。

> 为控制仓库体积，`bruno-original/resources/`（.blend / .psd / .pur 等原始美术工程）
> 与 `bruno-original/static/sounds/musics/`（三首大体积音乐）没有上传，
> 完整版本见[原仓库](https://github.com/brunosimon/folio-2025)。它们仍保留在本地。

## 截图

| 完整效果 | 裸模型 | 黄昏 |
| --- | --- | --- |
| ![](shuike-look/docs/look-full.png) | ![](shuike-look/docs/look-bare.png) | ![](shuike-look/docs/look-dusk.png) |

## 许可

MIT，见 [LICENSE](LICENSE)。

`shuike-look/` 是基于 Bruno Simon 的 folio-2025（MIT）重写的复现项目，原始代码与素材版权归
Bruno Simon 所有，其许可全文保留在 [`bruno-original/license.md`](bruno-original/license.md)。
`bruno-original/` 为原项目源码镜像，同样遵循 MIT。
