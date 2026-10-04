# Astra Motion

工程标识为 `astra-motion`；网页和动画中的展示品牌保留为 **GPT-6 Astra**。

用原生 JavaScript 和 Canvas 2D 绘制的 30 秒手绘宇宙动画。设计画布为 1920×1080，支持原生 1080p / 4K UHD（3840×2160）导出；时间线固定为 30 fps、900 帧（`0–899`）。网页播放器与视频导出共用同一个渲染器。

**零 npm 依赖：** 不需要 `npm install`、`npm ci` 或下载 Playwright 浏览器。预览、构建、测试和导出脚本仅使用 Node 内置模块；视频导出复用系统安装的 Chrome/Chromium 和 FFmpeg。构建不再进行 TypeScript 类型检查或打包压缩。

## 启动与构建

需要 Node.js **22.12 或更新版本**、npm，以及支持 ES 模块和 JSON import attributes 的现代浏览器。

```sh
npm run dev
```

打开终端给出的本地地址（默认 `http://127.0.0.1:5173/`）。源码修改后手动刷新浏览器；不提供热更新。端口可通过 `npm run dev -- --port=8080` 调整。

字体和音轨均从本地加载，首次点击播放后启用声音。控制条支持播放、暂停、重播、进度拖动、静音和全屏，位于动画画面外。空格播放/暂停，左右方向键逐帧移动，Shift + 方向键移动一秒，M 切换静音。片中的剪辑器按钮属于动画场景。

```sh
npm run build
npm run preview
```

构建检查 JavaScript 语法，将入口、源码、本地字体、许可证和音轨复制到 `dist/`，无需编译器或打包器。预览默认使用 `http://127.0.0.1:4173/`。部署时上传整个 `dist/` 并保持目录结构；相对路径也支持子目录部署。ES 模块需通过 HTTP 服务访问，不能直接双击 `index.html`。

## 画面与配乐

剪辑室置于靛蓝星海中，使用淡紫白面板、冰蓝星轨和星光金。蓝色机器人在星球日出、银河咖啡、太空猫和星际舞台四组素材间完成剪辑；素材库、飞入片段、时间轴与手机预览共用同一套画作。片尾六颗主星连成「A」形星座，彗星划出 Astra 签名下划线，落版文案为「灵感，奔赴群星。」

场景、字效、星空与角色由 Canvas 路径和渐变绘制。矢量宠物保留蓝色云朵头、深蓝屏幕、薄荷色 `>_` 与短四肢，每三个视频帧切换基础姿态；暂停、随机跳转与导出由固定种子和帧号驱动。线条动感来自局部描边与动作线，填色、文字和停留镜头保持稳定。

默认背景音乐直接使用用户提供的 **SuSu_酥酥👅 … #1.m4a**，源文件的原样副本保存在 `scripts/audio/background.m4a`，来源与混音配置见 `scripts/audio/background.json`。从开头原速使用前 30 秒，保留录音自身的旋律、音色与停顿，替换程序作曲的 BGM。现有剪切、飞入、纠错、抖动、导出等动作音效仍由本地代码独立合成，时刻读取共享时间轴；动作发生时轻微压低背景音乐，使音效清楚。混合音轨 `public/audio/generated.wav` 随源码附带，普通播放和构建无需 FFmpeg。

## 视频导出

仅在明确需要新成片时执行导出。需要系统 **Chrome 或 Chromium**、`ffmpeg` 和 `ffprobe`；FFmpeg 需支持 `loudnorm`、AAC 和 `libx264`。macOS 可选 `h264_videotoolbox` 硬件编码器。

```sh
# 默认 1080p，CPU 编码；也可显式使用 npm run render:1080p
npm run render

# 原生 4K UHD
npm run render:4k

# macOS 硬件编码；不可用时明确报错，不自动回退
npm run render:4k -- --gpu

# 自定义硬件目标码率
npm run render -- --gpu --bitrate=16M
```

脚本自动寻找已安装的 Chrome/Chromium。其他安装位置可用 `CHROMIUM_PATH` 指定**可执行文件**，例如：

```sh
CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run render
```

导出先混合上述背景录音与动作音效，再启动独立的临时浏览器配置目录和本地 HTTP 服务，通过 Chrome DevTools Protocol 逐帧绘制并获取 PNG，直接传给 FFmpeg。为保证截图与像素验证稳定，导出浏览器关闭 Canvas 硬件加速与后台限速；`--gpu` 只控制 FFmpeg 的视频编码器，不代表 Canvas 绘制加速。

软件与硬件 Canvas 的色阶和抗锯齿可能存在细微差异，旧截图不保证与新导出逐像素相同；缓存应按新的浏览器配置重新生成。

默认编码为 H.264 / yuv420p、30 fps、900 帧、30 秒，音轨为 192 kbps AAC。CPU 使用 `libx264 / slow / CRF 18`；硬件目标码率默认 1080p 为 12 Mbps，4K 为 48 Mbps。

| 内容 | 默认 1080p | 4K |
| --- | --- | --- |
| 成片 | `output/astra-motion.mp4` | `output/4k/astra-motion.mp4` |
| 采样图 | `output/keyframes/` | `output/4k/keyframes/` |
| 完整帧（可选） | `output/frames/` | `output/4k/frames/` |
| 编码验收报告 | `output/ffprobe.json` | `output/4k/ffprobe.json` |

导出和视频验证脚本统一使用上述新文件名；既有成片不会自动改名或重新生成。

FFprobe 检查尺寸、帧率、帧数、像素格式和音视频时长，并由 FFmpeg 完整解码两个流。通过验收后才替换最终 MP4；失败不覆盖已有成片。导出使用输出目录内的独占 `.render.lock` 和唯一临时目录，退出时先停止浏览器/编码器再释放锁。

若上次导出被强制终止，重新执行导出会检查锁的 PID，并通过系统 `ps` 确认没有 FFmpeg 在运行，再自动恢复遗留锁。为避免遗漏旧路径或目录别名下的编码器，任何正在运行的 FFmpeg（包括其他项目的编码）都会暂缓自动恢复。锁信息不完整、无法检查进程或锁的 PID 仍存在时保留锁；恢复过程用独占 `.render.lock.recovery` 避免并发清理。仍需手动清理时，先确认没有导出进程或 FFmpeg 在写入，再删除报错中指定的锁文件。

### 采样与帧缓存

```sh
# 61 张采样图，不生成视频或重新合成音轨
npm run render:samples

# 导出同时保存 900 张 PNG；占用空间较大
npm run render:frames

# 复用已由当前源码生成的完整帧缓存
npm run render:from-frames -- --gpu

# 仅刷新指定区间，不生成视频；要求已有完整帧缓存
npm run render -- --refresh-frames=735:899
```

这些命令也接受 `--resolution=4k`。PNG 默认使用无损快速截图 `--capture=fast`；可选 `--capture=standard` 获取压缩更小的无损 PNG。缓存预检检查每张 PNG 的头部、尺寸和结束标记；`verify:frames` 进一步完整解码并比较像素。画面修改后不得复用旧帧。

## 音轨生成与验证

```sh
npm run generate:audio
npm run verify:audio
```

解码 `scripts/audio/background.m4a`，裁剪或补静音至精确 30 秒，将背景音量预调至约 −24 LUFS，并用 25 Hz 高通去除直流偏移。与固定种子生成的现有音效混合后使用两遍 `loudnorm`，输出 48 kHz、16 位立体声 PCM WAV，整体响度约 −16 LUFS，真峰值不超过 −1.5 dBTP，首尾平滑淡入淡出。音效时刻读取 `src/timing.json`，每个画面帧对应 1600 个音频样本。临时音轨检查通过后才替换最终 WAV；背景源缺失或解码失败时保留已有音轨并报错。

生成报告写入 `output/audio-generation.json`，记录背景文件 SHA-256、混音增益、音效 PCM SHA-256 与整体响度。音频验证独立生成两次并比较实际 PCM，检查时长、响度、削波、直流偏移、首尾包络、音效起音及关键事件波形同步，同时确认替换 BGM 前后的音效通道逐样本一致，报告写入 `output/audio-verification.json`。听感仍需实际试听。

## 测试与验收

```sh
npm run build
npm run test:render
npm run verify
```

单测使用 Node 内置测试运行器，覆盖背景音乐替换及输入失败保护、音色确定性、程序音乐停顿与舞蹈起拍同步，以及编码器选项、截图选项、帧缓存、并发锁、HTTP 静态资源和媒体 Range 请求，无需浏览器或 FFmpeg。

`verify` 使用系统 Chrome/Chromium 检查字体阻塞与失败提示、音轨就绪、播放器操作、完整 30 秒音画同步、桌面/移动布局、镜头稳定、角色动作与触点、跳帧确定性、1080p/4K 渲染以及少量 PNG 截图与 Canvas 像素的一致性，不导出视频或保存完整帧序列。报告为 `output/verification.json`，少量截图在 `output/screenshots/`。

已有**与当前源码一致**的成片或完整帧时，可以再运行：

```sh
npm run verify:video
npm run verify:audio -- --video
npm run verify:frames
```

上述命令接受 `--resolution=4k`。视频验证检查成片元数据、跳转和完整播放；AAC 验证检查音轨内容、延迟和响度；帧验证完整解码 900 张已有 PNG 并与当前源码像素比较。缺少产物时跳过对应检查，不为验证自动导出视频。

## 修改动画

| 路径 | 内容 |
| --- | --- |
| `src/main.js` | 音轨时钟、播放器交互与就绪状态 |
| `src/renderer.js` | 整体合成、手机预览、角色动作、字效与片尾 |
| `src/timing.json` | 共享帧率、帧数和零起始事件时刻 |
| `src/render-profiles.json` | 1080p/4K 尺寸与默认硬件码率 |
| `src/timeline.js` | 镜头关键帧、字幕、预览切换与导出进度 |
| `src/character.js` | 原生矢量角色、姿态、伸手触点与表情 |
| `src/editor.js` / `src/media.js` | 编辑器界面与四组共享素材 |
| `src/astra.js` / `src/sketch.js` / `src/ink.js` | 星海图形、配色、字体、画笔与确定性线条 |
| `src/reference-motion.json` / `src/reference-camera.json` | 运行所需的几何标定数据，不包含参考片像素 |
| `scripts/audio/` | 背景录音与混音配置、程序编曲和音效合成 |
| `scripts/` | 零 npm 依赖的服务、构建、导出与验证工具 |

调整事件从 `src/timing.json` 开始，并一起检查相关动作区间和音效；时间换算为 `秒数 = 帧号 / 30`。修改时间轴或音轨后重新生成并验证音频。

在浏览器控制台绘制单帧：

```js
await window.animationReady;
window.animation.pause();
window.renderFrame(450);
```

`renderFrame()` 向下取整并约束到 `0–899`，不会移动音轨或更新整个控制条；交互式跳转使用 `window.animation.seek(450)`。导出模式可访问 `/?render&frame=450` 或 `/?render&resolution=4k&frame=450`。

## 灵感来源

- [X 帖文](https://x.com/NFT_Chen/status/2102681172367323300)（2026 年 9 月 23 日）
- [抖音视频](https://v.douyin.com/FPI9nD4sOck/)（2026-09-25 14:18）

以上为目前记录的灵感参考链接；原始创作者尚未确认，暂不据此认定原创归属。

## 轻量化范围与素材归属

项目保留可编辑源码、必要几何数据、本地字体与许可证、当前背景录音及混合音轨和核心导出/验证工具。已移除开发依赖、参考帧与历史音轨、未使用的精灵图、校准/对照/基准/角色审阅工具，以及旧成片、帧缓存、截图、报告和源码压缩包。`dist/`、`output/` 和临时目录均忽略提交，按需重新生成。

参考视频和原始精灵图由用户提供，不再随项目分发；其角色设计来源与字体许可仍记录在 [THIRD_PARTY.md](THIRD_PARTY.md)。运行所需的几何 JSON 必须保留。删除工作目录中的生成文件不会缩小已有 Git 历史，本次不改写历史。
