# README 展示素材

这些文件来自本项目的 `http://127.0.0.1:8812/` 测试页与 `?pet=1` 桌宠页，使用真实的 Three.js 渲染、骨架、表情和动作。

- `test-page.png`：包含控制栏和进度条的测试页截图。
- `hello.png`：固定台词的挥手／气泡截图。
- `walk-climb.mp4` / `.gif`：8 秒固定镜头，模拟原生导航消息，先走路再攀爬。画面不演示桌面窗口坐标移动。
- `expressions.mp4` / `.gif`：10 秒固定台词，展示挥手、歪头和转晕表情；转晕表情通过表情接口预览，未在这段视频中模拟转圈拖动。

录制时屏蔽了非本地网络请求，没有读取真实桌面、发送截图或调用云端模型。浅蓝底色仅用于展示透明的桌宠画布。MP4 为 600 × 640、15 fps，GIF 为 400 像素宽、12 fps。

重新录制：先启动 `python3 scripts/serve.py`，准备 Playwright Core / Chromium 和 PATH 中的 ffmpeg，再运行 `node scripts/capture_readme.mjs`。也可将 `PLAYWRIGHT_CORE` 指向已有的 `playwright-core/index.mjs`。脚本按 30 fps 推进动画，每两帧截取一次，避免录制机器速度改变动作节奏；`--stills` 只更新静态截图。
