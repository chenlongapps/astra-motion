<h1 align="center">Astra Motion</h1>

<p align="center">原生 JavaScript + Canvas 2D 绘制的 30 秒手绘宇宙动画。</p>

<p align="center">
  <a href="https://github.com/chenlongapps/astra-motion/actions/workflows/deploy-pages.yml"><img alt="Deploy to GitHub Pages" src="https://img.shields.io/github/actions/workflow/status/chenlongapps/astra-motion/deploy-pages.yml?style=flat-square&amp;branch=main&amp;label=deploy" /></a>
  <a href="https://chenlongapps.github.io/astra-motion/"><img alt="Live Demo" src="https://img.shields.io/badge/demo-live-brightgreen?style=flat-square" /></a>
  <a href="https://nodejs.org/"><img alt="Node.js 22.12+" src="https://img.shields.io/badge/node-%3E%3D22.12-339933?style=flat-square&amp;logo=node.js&amp;logoColor=white" /></a>
  <a href="package.json"><img alt="Zero dependencies" src="https://img.shields.io/badge/dependencies-0-blue?style=flat-square" /></a>
</p>

<p align="center">
  <a href="https://chenlongapps.github.io/astra-motion/">在线演示</a> ·
  <a href="#快速开始">快速开始</a>
</p>

<video src="https://github.com/user-attachments/assets/c4a6ff5e-292d-4827-a8f0-d115516b1889" controls width="960" preload="metadata"></video>

---

### 快速开始

```bash
npm run dev
```

> [!NOTE]
> 需要 Node.js **22.12+**。**零 npm 依赖**，无需 `npm install`。

打开 [http://127.0.0.1:5173/](http://127.0.0.1:5173/) 即可播放。通过 HTTP 访问，不直接双击 `index.html`；修改源码后手动刷新页面，无热更新。

构建与预览：

```bash
npm run build    # 检查语法并输出到 dist/
npm run preview  # http://127.0.0.1:4173/ 预览 dist/
```

#### 浏览器导出

点击播放器右上角的**导出**，可选择 1080p / 4K 和 30 / 60 fps，默认生成含配乐的 1080p60 MP4。需要 HTTPS 或 localhost 环境，以及支持 H.264 编码的 WebCodecs。设备支持按画质与帧率组合检测，下载文件名包含帧率。

本地渲染、配乐、验证与动画修改说明见 `AGENTS.md`。

### GitHub Pages 部署

1. 仓库 Settings → Pages → Source 选择 **GitHub Actions**（只需一次）。
2. 推送到 `main` 或手动触发 [Deploy to GitHub Pages](.github/workflows/deploy-pages.yml) 工作流。
3. 工作流执行 `npm test` → `npm run build`，将 `dist/` 发布到 Pages。

### 灵感来源与归属

- [X 帖文](https://x.com/NFT_Chen/status/2102681172367323300)（2026-09-23）
- [抖音视频](https://v.douyin.com/FPI9nD4sOck/)（2026-09-25）

字体与角色来源见 [THIRD_PARTY.md](THIRD_PARTY.md)。
