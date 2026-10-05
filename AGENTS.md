# 仓库指南

## 项目结构与模块组织

这是一个无依赖项目，使用原生 JavaScript 模块，通过 Canvas 2D 渲染一段 30 秒动画。

- `src/`：播放器（`main.js`）、共享渲染器（`renderer.js`）、角色、场景和绘制模块。`timing.json` 定义动画与音频共用的事件；`render-profiles.json` 定义导出分辨率。
- `scripts/`：本地服务器、构建、导出、验证工具及其测试。`scripts/audio/` 包含编曲和合成代码。
- `public/`：打包字体、许可证文件和 `audio/generated.wav`。
- `index.html`：播放器入口文件。`dist/` 和 `output/` 存放生成的产物，且已被 Git 忽略。

## 构建、测试与开发命令

使用 Node.js **22.12 或更高版本**。无需安装 npm 依赖；外部本机工具（Chrome/Chromium、FFmpeg/FFprobe）的要求见「系统依赖」。

- `npm run dev`：在 `http://127.0.0.1:5173/` 启动本地服务；修改后需手动刷新页面。
- `npm run build`：检查源 JavaScript 语法，并将可部署文件复制到 `dist/`。
- `npm run preview`：在 4173 端口预览 `dist/`。
- `npm test`：运行单元测试；`npm run test:render` 是它的别名。
- `npm run verify`：运行浏览器集成检查，并将报告和截图写入 `output/`；需要已安装 Chrome/Chromium。`npm run verify -- --fps=60` 跑 60 fps 播放回归；有成片时用 `npm run verify:video` 验证视频。
- `npm run generate:audio` / `npm run verify:audio`：重新生成或验证配乐；需要 FFmpeg。背景录音取 `scripts/audio/background.m4a` 前 30 秒，动作音效由代码合成，时刻以 `src/timing.json` 为准；修改时间轴后重新运行这两个命令。
- 本地导出需要系统 Chrome/Chromium、FFmpeg 和 FFprobe，仅在需要新成片时运行。未经用户明确要求，不要主动导出视频；仅在用户要求导出或明确需要生成新视频时执行。
  - `npm run render`：默认 1080p30，输出 `output/30fps/astra-motion.mp4`。
  - `npm run render:4k`：4K30，输出 `output/4k/30fps/astra-motion.mp4`。
  - `npm run render -- --fps=60`：1080p60，输出 `output/60fps/astra-motion.mp4`；`--resolution=4k --fps=60` 为 4K60。
  - `npm run render -- --gpu --bitrate=16M`：macOS 硬件编码示例。
  - 抓帧默认按机器并行度开多个渲染页（默认 ≤4，`--workers=1` 可回到单页串行；帧仍按帧号顺序写入编码器与缓存）。配乐在背景录音、时间轴与合成源码未变时复用上次成品，`node scripts/generate-audio.mjs --force` 可强制重算。
  - `npm run render:samples` 只生成采样图；`npm run render:frames` 导出并保留 PNG 帧；`npm run render:from-frames` 复用帧缓存导出。以上命令均支持 `--fps=30` / `--fps=60`；通过 `CHROMIUM_PATH` 可指定浏览器可执行文件。
  - 导出按阶段输出进度与预估（`audio` → `cache` → `browser` → `capture` → `encode` → `validate`，采样/局部刷新只走其中几步）：交互终端单行原地刷新，管道或 CI 中每 5 秒一行。内容含当前阶段、帧进度与百分比、实测速度、已用、剩余预估、全流程预计总时长与预计完成时刻，预热阶段显示 `estimating`。ETA 先以上次同配置导出的 `ffprobe.json` 计时为种子，再按实测速率修正；编码收尾阶段解析 FFmpeg `-progress` 输出显示已编码帧数。实现见 `scripts/render-progress.mjs`。
  - 输出与缓存按分辨率、帧率分目录，缓存清单校验尺寸、帧率、总帧数及渲染源码/字体指纹。旧的无清单缓存需重新生成；修改视觉内容后重新生成完整缓存，或使用 `--refresh-frames=START:END` 局部刷新，再运行 `npm run verify:frames -- --resolution=1080p --fps=60` 验证全部像素并更新清单。所有帧号均按所选输出帧率解释。

## 系统依赖

项目本身没有 npm 依赖（`package.json` 无 `dependencies`），仅要求 Node.js **22.12 或更高版本**。需要外部本机程序的只有两类：**Chrome/Chromium** 与 **FFmpeg/FFprobe**，按脚本要求如下。

- `dev`、`preview`、`build`、`test`：纯 Node，无需安装任何外部工具。
- `generate:audio`、`generate:export-audio`、`export-audio`、`verify:audio`：只需 FFmpeg。
- `render` 及各 `render:*` 变体：Chrome/Chromium 抓帧 + FFmpeg/FFprobe 编码与校验，两者都要。
- `verify`、`verify:frames`、`verify:video`：只需 Chrome/Chromium。
- `verify:export`：浏览器导出校验，两者都要。

| 命令 | Chrome/Chromium | FFmpeg/FFprobe |
| --- | --- | --- |
| `dev` / `preview` / `build` / `test` | 否 | 否 |
| `generate:audio` / `generate:export-audio` / `export-audio` / `verify:audio` | 否 | 是 |
| `render` / `render:1080p` / `render:4k` / `render:samples` / `render:frames` / `render:from-frames` | 是 | 是 |
| `verify` / `verify:frames` / `verify:video` | 是 | 否 |
| `verify:export` | 是 | 是 |

Chrome 查找顺序见 `scripts/browser.mjs`：`CHROMIUM_PATH` 环境变量 → macOS 的 `/Applications/Google Chrome.app`、`/Applications/Chromium.app`、`~/Applications` 下同名路径 → `PATH` 中的 `google-chrome` / `chromium` 等 → Windows `Program Files` 位置；全部未命中时报错，不会自动下载浏览器。FFmpeg 与 FFprobe 需在 `PATH` 中（或自行确保可执行文件可被解析），缺失时相关脚本会以子进程错误退出。

## 编码风格与命名约定

遵循现有风格：JavaScript 缩进为两个空格，使用单引号和分号。函数及变量使用 camelCase，类使用 PascalCase，共享常量使用全大写。浏览器模块使用 `.js` 扩展名；Node 脚本使用 `.mjs` 扩展名和描述性 kebab-case 文件名。使用原生 ES 模块和 Node 内置模块；项目未配置格式化工具或代码检查工具。

## 测试指南

使用 `node:test` 和 `node:assert/strict`。测试文件命名为 `scripts/*.test.mjs`，并在测试标题中描述行为。针对已修改的导出或服务器行为及其失败场景编写测试；不设数值覆盖率门槛。提交代码更改前运行 `npm test` 和 `npm run build`。若修改动画或播放器，还应运行 `npm run verify` 并检查受影响的帧。

## 提交与拉取请求指南

仓库目前没有提交记录，因此尚无既定的提交消息规范。使用简洁的祈使式主题，例如 `Fix frame-cache validation`。拉取请求应说明更改内容、列出验证命令及结果、关联相关问题，并在涉及视觉更改时附上截图。文档改动需同步维护中英文两份 README（`README.md` 与 `README.en.md`），保持内容与结构一致。

## 动画与资源指南

保持帧渲染结果确定：30 秒，默认 30 fps / 900 帧（`0–899`），可选 60 fps / 1800 帧（`0–1799`）。`src/timing.json` 中的 `fps`、`frames`、`cues` 为 30 fps 编排时基，输出帧率由 `defaultFps`、`supportedFps` 和 `src/frame-timing.js` 管理；渲染入口将输出帧换算为编排帧，并对校准数据与连续动画插值。通过 `src/timing.json` 协调动作时刻调整，并重新生成受影响的音频。输出与帧缓存按分辨率和帧率隔离；视觉内容变更后重新构建过期缓存，局部刷新后须用 `verify:frames` 完整验像素再更新清单。保留校准 JSON、字体许可证以及 `THIRD_PARTY.md` 中的署名信息。

关键路径：`src/renderer.js` 负责合成、角色动作、字效、片尾；`src/timeline.js` 负责镜头、字幕、预览切换；`src/character.js` / `src/editor.js` / `src/media.js` 负责角色、剪辑室、素材。

单帧调试用 `/?render&fps=60&frame=900`（15 秒）或 `/?render&fps=30&frame=450`；播放器可用 `/?fps=30` 预览 30 fps。`window.animation` 提供当前 `fps`、`frames`、`duration` 及换算到输出帧的 `cues`。
