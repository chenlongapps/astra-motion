# Astra Motion

[![Deploy to GitHub Pages](https://github.com/chenlongapps/astra-motion/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/chenlongapps/astra-motion/actions/workflows/deploy-pages.yml) [![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://chenlongapps.github.io/astra-motion/) [![Node.js](https://img.shields.io/badge/node-%3E%3D22.12-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![Dependencies](https://img.shields.io/badge/dependencies-0-blue)](package.json)

原生 JavaScript + Canvas 2D 绘制的 30 秒手绘宇宙动画：1920×1080，30 fps，共 900 帧（`0–899`）。网页播放器与视频导出共用同一渲染器。

**零 npm 依赖**，无需 `npm install`。需 Node.js **22.12+**。

**在线演示：[https://chenlongapps.github.io/astra-motion/](https://chenlongapps.github.io/astra-motion/)**

## 在线演示

[https://chenlongapps.github.io/astra-motion/](https://chenlongapps.github.io/astra-motion/)（`main` 分支推送后由 GitHub Actions 自动构建部署）

## GitHub Pages 部署

1. 仓库 Settings → Pages → Source 选择 **GitHub Actions**（只需一次）。
2. 推送到 `main` 或手动触发 `Deploy to GitHub Pages` 工作流。
3. 工作流执行 `npm test` → `npm run build`，将 `dist/` 发布到 Pages。

## 演示视频

<video src="assets/astra-motion.mp4" controls width="960" preload="metadata"></video>

## 启动与构建

```sh
npm run dev      # http://127.0.0.1:5173/
npm run build    # 检查语法并输出到 dist/
npm run preview  # http://127.0.0.1:4173/ 预览 dist/
```

通过 HTTP 访问，勿直接双击 `index.html`。改源码后手动刷新，无热更新。

播放器：空格播放/暂停，左右方向键逐帧，Shift + 方向键跳 1 秒，M 静音。右上角**导出**可在浏览器内直接生成 1080p / 4K MP4（含配乐，需 HTTPS 或 localhost + H.264 WebCodecs 支持）。

## 视频导出（本地工具链）

仅需新成片时运行，需系统 Chrome/Chromium + FFmpeg + FFprobe。

```sh
npm run render       # 默认 1080p，输出 output/astra-motion.mp4
npm run render:4k    # 4K，输出 output/4k/astra-motion.mp4
npm run render -- --gpu --bitrate=16M  # macOS 硬件编码示例
```

其他：`render:samples` 只出采样图，`render:frames` 保留 PNG，`render:from-frames` 复用帧缓存。`CHROMIUM_PATH` 可指定浏览器可执行文件。

## 配乐

```sh
npm run generate:audio  # 混音 30 秒 WAV
npm run verify:audio    # 验证音轨
```

背景录音取 `scripts/audio/background.m4a` 前 30 秒，动作音效由代码合成，时刻以 `src/timing.json` 为准。改时间轴后重跑上面两条。

## 测试与验收

```sh
npm run build
npm run test
npm run verify        # 浏览器集成检查，需 Chrome/Chromium
npm run verify:video  # 有成片时验证视频
```

## 修改动画

时间换算：`秒数 = 帧号 / 30`，先改 `src/timing.json`。

| 路径 | 内容 |
| --- | --- |
| `src/renderer.js` | 合成、角色动作、字效、片尾 |
| `src/timeline.js` | 镜头、字幕、预览切换 |
| `src/character.js` / `src/editor.js` / `src/media.js` | 角色、剪辑室、素材 |
| `src/timing.json` / `src/render-profiles.json` | 时间轴 / 分辨率配置 |
| `scripts/` | 服务、构建、导出、验证工具 |

单帧调试：`/?render&frame=450`。

## 灵感来源与归属

- [X 帖文](https://x.com/NFT_Chen/status/2102681172367323300)（2026-09-23）
- [抖音视频](https://v.douyin.com/FPI9nD4sOck/)（2026-09-25）

字体与角色来源见 [THIRD_PARTY.md](THIRD_PARTY.md)。`dist/`、`output/` 为生成目录，不提交。
