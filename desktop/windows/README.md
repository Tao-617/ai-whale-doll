# 小鲸 Windows 桌宠

Windows 10/11 x64 的 Electron 外壳，复用 `../../web` 的模型、动画和交互。0.6.0 的 portable EXE 可直接运行，不需要用户安装 Node 或 Python。托盘菜单提供尺寸、自由活动、聊天、模型设置和观察选项。

开发与打包使用 Node 24：

```sh
cd desktop/windows
npm ci
npm test
npm run pack
```

产物：`../dist/windows/Xiaojing-0.6.0-Windows-x64.exe`。构建使用锁定的 Electron / electron-builder 版本，可在 Mac 上交叉生成 EXE；跨平台打包通过不等于 Windows 桌面运行验收通过。

`geometry.cjs` 负责边缘路径和缩放归边，`observation.cjs` 负责观察节奏与回复交付，`native/window.ps1` 只返回前台窗口信息、键鼠活动间隔及指定窗口的内存截图。不能捕获的窗口跳过，不截整屏。模型配置由使用者填写，密钥通过 Windows 系统加密保存，发布包不含开发者配置。

当前未做商业代码签名，也未在真实 Windows 桌面验收透明窗口、托盘、不同 DPI 显示器和 PrintWindow 兼容性。使用说明见 [安装说明](../../docs/install-0.6.txt)，验证范围见 [项目说明](../../README.md#验证与限制)。
