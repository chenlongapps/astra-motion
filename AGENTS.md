# 仓库指南

## 项目结构与模块组织

这是一个无依赖项目，使用原生 JavaScript 模块，通过 Canvas 2D 渲染一段 30 秒动画。

- `src/`：播放器（`main.js`）、共享渲染器（`renderer.js`）、角色、场景和绘制模块。`timing.json` 定义动画与音频共用的事件；`render-profiles.json` 定义导出分辨率。
- `scripts/`：本地服务器、构建、导出、验证工具及其测试。`scripts/audio/` 包含编曲和合成代码。
- `public/`：打包字体、许可证文件和 `audio/generated.wav`。
- `index.html`：播放器入口文件。`dist/` 和 `output/` 存放生成的产物，且已被 Git 忽略。

## 构建、测试与开发命令

使用 Node.js **22.12 或更高版本**。无需安装依赖。

- `npm run dev`：在 `http://127.0.0.1:5173/` 启动本地服务；修改后需手动刷新页面。
- `npm run build`：检查源 JavaScript 语法，并将可部署文件复制到 `dist/`。
- `npm run preview`：在 4173 端口预览 `dist/`。
- `npm test`：运行单元测试；`npm run test:render` 是它的别名。
- `npm run verify`：运行浏览器集成检查，并将报告和截图写入 `output/`；需要已安装 Chrome/Chromium。
- `npm run generate:audio` / `npm run verify:audio`：重新生成或验证配乐；需要 FFmpeg。
- `npm run render -- --resolution=4k`：使用 Chrome/Chromium、FFmpeg 和 FFprobe 导出视频。未经用户明确要求，不要主动导出视频；仅在用户要求导出或明确需要生成新视频时执行。

## 编码风格与命名约定

遵循现有风格：JavaScript 缩进为两个空格，使用单引号和分号。函数及变量使用 camelCase，类使用 PascalCase，共享常量使用全大写。浏览器模块使用 `.js` 扩展名；Node 脚本使用 `.mjs` 扩展名和描述性 kebab-case 文件名。使用原生 ES 模块和 Node 内置模块；项目未配置格式化工具或代码检查工具。

## 测试指南

使用 `node:test` 和 `node:assert/strict`。测试文件命名为 `scripts/*.test.mjs`，并在测试标题中描述行为。针对已修改的导出或服务器行为及其失败场景编写测试；不设数值覆盖率门槛。提交代码更改前运行 `npm test` 和 `npm run build`。若修改动画或播放器，还应运行 `npm run verify` 并检查受影响的帧。

## 提交与拉取请求指南

仓库目前没有提交记录，因此尚无既定的提交消息规范。使用简洁的祈使式主题，例如 `Fix frame-cache validation`。拉取请求应说明更改内容、列出验证命令及结果、关联相关问题，并在涉及视觉更改时附上截图。

## 动画与资源指南

保持帧渲染结果确定：30 fps，共 900 帧，索引范围为 `0–899`。通过 `src/timing.json` 协调时间调整，并重新生成受影响的音频。视觉内容变更后，重新构建已过期的帧缓存。保留校准 JSON、字体许可证以及 `THIRD_PARTY.md` 中的署名信息。
