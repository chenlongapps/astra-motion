# 第三方素材与组件

本文件记录项目随附字体、背景录音、动作音效和参考设计来源。项目没有 npm 依赖，不打包第三方浏览器或媒体处理工具。

## 字体

字体位于 `public/fonts/`，由 `src/style.css` 本地加载，不请求外部字体服务。四套字体及其 SIL Open Font License 1.1 原文一起复制到网页构建产物。

| 字体 / 文件 | 版权声明 | 随附许可证 |
| --- | --- | --- |
| Patrick Hand / `PatrickHand-Regular.ttf` | Copyright (c) 2010–2012 Patrick Wagesreiter | [PatrickHand-OFL.txt](public/fonts/PatrickHand-OFL.txt) |
| Lilita One / `LilitaOne-Regular.ttf` | Copyright (c) 2011 Juan Montoreano；Reserved Font Name: Lilita | [LilitaOne-OFL.txt](public/fonts/LilitaOne-OFL.txt) |
| Caveat / `Caveat.ttf` | Copyright 2014 The Caveat Project Authors | [Caveat-OFL.txt](public/fonts/Caveat-OFL.txt) |
| ZCOOL KuaiLe / `ZCOOLKuaiLe-Regular.ttf` | Copyright 2018 The ZCOOL KuaiLe Project Authors | [ZCOOLKuaiLe-OFL.txt](public/fonts/ZCOOLKuaiLe-OFL.txt) |

`src/sketch.js` 的 `fontFor()` 在文本含中日韩字符时使用 ZCOOL KuaiLe，纯英文仍使用 Patrick Hand / Lilita One / Caveat。版权与使用条件以随附许可证原文为准。

## 参考视频与几何数据

动画以用户提供的 `Opus 5.5 动画秀：代码也能画出这么丝滑的短片.mp4` 为参考。项目不再分发参考帧、标定证据图片、历史参考音轨或对照图库；工作区上一级的用户原视频未作改动。

`src/reference-motion.json` 与 `src/reference-camera.json` 只记录从参考片分析得到的位置、宽高、旋转和镜头几何变换，不保存原片像素。它们是运行所需数据；参考视频与参考帧不会作为播放器或成片的背景。

参考素材未附带独立再许可声明，权利归其原权利人，不属于字体的 OFL 许可范围。移除参考文件不改变其设计来源或许可状态。

## 背景音乐与动作音效

按用户要求，当前 BGM 直接使用其提供的 `SuSu_酥酥👅 - 😱无敌了！Opus 5.5 自己写了一套卡通剪辑软件，然后钻进去剪完了！  不走视频模型，纯程序，code2video！  Claude ... #1.m4a`，原样副本保存在 `scripts/audio/background.m4a`，来源文件名与混音配置记录在 `scripts/audio/background.json`。从开头原速使用前 30 秒，调整音量、去除直流偏移并与既有动作音效混合，输出为 `public/audio/generated.wav`。

背景录音及当前混合音轨包含用户提供的第三方录音内容。原始作者与独立再许可声明尚未确认，权利归其原权利人；录音不属于字体的 OFL 许可范围，项目未为其声明新的许可证。

动作音效继续由 `scripts/audio/score.mjs` 与 `scripts/audio/synth.mjs` 使用数学振荡器、滤波噪声和固定随机种子本地生成，无第三方录音乐器采样或外部音效生成服务。替换 BGM 时保留音效通道、参数及共享时间轴。每次混音时，背景源 SHA-256、音效 PCM SHA-256、最终 PCM SHA-256 与响度写入 `output/audio-generation.json`。

## Codex 宠物

角色参照用户提供的 `codex-spritesheet-v6-51045ae208c0.webp`。原先保留的 `public/sprites/codex-pet.webp` 不参与运行，已在轻量化中移除；工作区上一级的原图未作改动。

`src/character.js` 参照蓝色云朵头、屏幕、终端符号、配色与动作，以原生 Canvas 矢量路径绘制。主角、舞蹈预览和缩略图共用该代码，不读取精灵图像素或依赖图片解码；网页图标使用与宠物轮廓和配色一致的内嵌 SVG。

用户提供的素材未附带独立版权或再许可声明，项目不为其指定作者或许可证；它不属于字体的 OFL 许可范围。矢量重绘不意味着取得新的角色设计权利或再许可，项目未为重绘角色额外声明许可证。

## 运行环境工具

预览、构建和脚本使用 Node.js 内置功能。自动导出与浏览器验证通过 Chrome DevTools Protocol 连接系统已安装的 Chrome/Chromium；FFmpeg / ffprobe 由运行环境提供。macOS 硬件编码使用 FFmpeg 的 VideoToolbox 支持。

上述工具的可执行文件不随项目分发，版权与许可证以各自发行包的声明为准。原 Vite、TypeScript、Playwright、sharp 及其传递 npm 依赖已移除。
