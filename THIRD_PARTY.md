# 第三方素材与组件

本文件记录仓库内的第三方字体、录音与参考设计来源，以及不随项目分发的运行环境工具。项目无 npm 依赖（`package.json` 无 `dependencies`），不打包第三方浏览器、媒体库或构建工具。

## 字体

字体文件与各自的 SIL Open Font License 1.1 原文存放在 `public/fonts/`，由 `src/style.css` 以 `@font-face` 本地加载，不请求外部字体服务。构建时该目录原样复制到产物 `dist/fonts/`，字体与许可证文本一起分发。版权与使用条件以各 `*-OFL.txt` 原文为准，以下仅为持有人摘要，不代替原文。

| 字体 | 文件 | 随附许可证 |
| --- | --- | --- |
| Patrick Hand | `PatrickHand-Regular.ttf` | [PatrickHand-OFL.txt](public/fonts/PatrickHand-OFL.txt) |
| Lilita One | `LilitaOne-Regular.ttf` | [LilitaOne-OFL.txt](public/fonts/LilitaOne-OFL.txt) |
| Caveat | `Caveat.ttf` | [Caveat-OFL.txt](public/fonts/Caveat-OFL.txt) |
| ZCOOL KuaiLe | `ZCOOLKuaiLe-Regular.ttf` | [ZCOOLKuaiLe-OFL.txt](public/fonts/ZCOOLKuaiLe-OFL.txt) |

`src/sketch.js` 的 `fontFor()` 在文本含中日韩字符时选用 ZCOOL KuaiLe，否则使用拉丁字体（Patrick Hand / Lilita One / Caveat）。

## 参考视频与几何数据

动画设计参照用户提供的 Opus 5.5 动画短片。仓库内不含参考视频、参考帧或任何原片像素；`src/reference-motion.json` 与 `src/reference-camera.json` 只保存纯数值的几何变换（位置、宽高、旋转、镜头参数），分别由 `src/renderer.js` 与 `src/timeline.js` 在运行期读入。参考视频与参考帧不作为播放器或成片的背景。

## 背景音乐与动作音效

当前 BGM 按用户要求取自 [X 帖文](https://x.com/NFT_Chen/status/2102681172367323300)（2026-09-23）。原样副本为 `scripts/audio/background.m4a`，来源与混音配置（文件名、标题、高通频率、目标响度）记录在 `scripts/audio/background.json`。混音从开头原速取前 30 秒，经高通滤波与响度增益后，与程序化动作音效混合并做响度归一化，输出为 `public/audio/generated.wav`；混音报告（含背景源、音效与最终 PCM 的 SHA-256 及响度）写入 `output/audio-generation.json`。

`public/audio/generated.m4a` 是上述 WAV 的 AAC-LC 编码副本（48 kHz 双声道），`public/audio/export-audio.json` 绑定 WAV / M4A 哈希与帧率帧数用于过期校验。网页导出调用浏览器原生 WebCodecs（`VideoEncoder`）编码视频，AAC 解析与 MP4 封装由 `src/mp4.js` 原生实现，无第三方 JavaScript 媒体库。

动作音效由 `scripts/audio/score.mjs` 与 `scripts/audio/synth.mjs` 以数学振荡器、滤波噪声和固定随机种子本地合成，无第三方录音乐器采样或外部音效服务。

## Codex 宠物

角色设计源自 OpenAI 官方 Codex 宠物形象，参照用户提供的官方精灵图副本（`codex-spritesheet-v6-51045ae208c0.webp`）进行矢量重绘，权利归 OpenAI 所有。仓库内未分发该原图及任何精灵像素（`public/sprites/` 不存在）；`src/character.js` 以原生 Canvas 矢量路径（`Path2D`）绘制，不做图片解码；网页图标为 `index.html` 内与宠物轮廓配色一致的内嵌 SVG。

## 运行环境工具

预览、构建与脚本仅使用 Node.js 内置模块。浏览器自动化是仓库自研的 Chrome DevTools Protocol 客户端（`scripts/browser.mjs`），连接系统已安装的 Chrome/Chromium，不自动下载浏览器，可用 `CHROMIUM_PATH` 指定。渲染、导出与音频管线调用运行环境提供的 FFmpeg / ffprobe；默认视频编码为 CPU 的 libx264（CRF 18），仅在 `--gpu` / `--encoder=videotoolbox` 时使用 macOS 的 `h264_videotoolbox` 硬件编码。上述工具的可执行文件不随项目分发。

## 许可边界

字体的 OFL 1.1 仅适用于 `public/fonts/` 内的字体。参考设计、背景录音未附带独立再许可声明，Codex 角色设计权利归 OpenAI 所有，项目未为其声明新许可证；几何重测、混音与矢量重绘不产生新的权利或再许可。
