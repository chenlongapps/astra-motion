<h1 align="center">Astra Motion</h1>

<p align="center">A 30-second hand-drawn cosmos animation rendered with native JavaScript and Canvas 2D.</p>

<p align="center">
  <a href="https://github.com/chenlongapps/astra-motion/actions/workflows/deploy-pages.yml"><img alt="Deploy to GitHub Pages" src="https://img.shields.io/github/actions/workflow/status/chenlongapps/astra-motion/deploy-pages.yml?style=flat-square&amp;branch=main&amp;label=deploy" /></a>
  <a href="https://chenlongapps.github.io/astra-motion/"><img alt="Live Demo" src="https://img.shields.io/badge/demo-live-brightgreen?style=flat-square" /></a>
  <a href="https://nodejs.org/"><img alt="Node.js 22.12+" src="https://img.shields.io/badge/node-%3E%3D22.12-339933?style=flat-square&amp;logo=node.js&amp;logoColor=white" /></a>
  <a href="package.json"><img alt="Zero dependencies" src="https://img.shields.io/badge/dependencies-0-blue?style=flat-square" /></a>
</p>

<p align="center">
  <a href="README.md">中文</a> · <strong>English</strong>
</p>

<p align="center">
  <a href="https://chenlongapps.github.io/astra-motion/">Live Demo</a> ·
  <a href="#quick-start">Quick Start</a>
</p>

<video src="https://github.com/user-attachments/assets/c4a6ff5e-292d-4827-a8f0-d115516b1889" controls width="960" preload="metadata"></video>

---

### Quick Start

```bash
npm run dev
```

> [!NOTE]
> Requires Node.js **22.12+**. **Zero npm dependencies** — no `npm install` needed.

Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/) to start playback. Serve it over HTTP instead of opening `index.html` directly from disk; refresh the page manually after editing source files — there is no hot reload.

Build and preview:

```bash
npm run build    # validate syntax and stage to dist/
npm run preview  # serve dist/ at http://127.0.0.1:4173/
```

#### Browser Export

Click the **Export** button in the top-right corner of the player to pick 1080p / 4K and 30 / 60 fps. By default it produces a 1080p60 MP4 with the soundtrack. An HTTPS or localhost context is required, along with WebCodecs support for H.264 encoding. Supported quality and frame-rate combinations are detected per device, and the download filename includes the frame rate.

Local rendering, soundtrack generation, verification, and animation notes live in `AGENTS.md`.

### Deploy to GitHub Pages

1. Repository Settings → Pages → Source: choose **GitHub Actions** (one time only).
2. Push to `main` or manually trigger the [Deploy to GitHub Pages](.github/workflows/deploy-pages.yml) workflow.
3. The workflow runs `npm test` → `npm run build` and publishes `dist/` to Pages.

### Inspiration and Credits

- [X post](https://x.com/NFT_Chen/status/2102681172367323300) (2026-09-23)
- [Douyin video](https://v.douyin.com/FPI9nD4sOck/) (2026-09-25)

Font and character credits are listed in [THIRD_PARTY.md](THIRD_PARTY.md).
