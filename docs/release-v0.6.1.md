# 小鲸 / Xiaojing 0.6.1 · Preview

- 攀爬重做：四肢依次换抓点，双腿交替屈膝、蹬伸，身体转移重心。采用背面偏侧朝向，上下爬使用相反循环，停步保持姿势。
- Mac 和 Windows 随机侧边攀爬速度降低，动作跟随实际移动速度；随机活动仍沿四周边缘，截图主动移动保持独立。
- README 增加完整英文版，更新真实模型演示和整体／骨骼对照视频。

- Reworked climbing: alternating handholds, knee lifts and foot pushes, with weight shifts and a rear three-quarter pose. Descending reverses the cycle; stopping holds the pose.
- Slower vertical roaming on Mac and Windows, with animation driven by actual travel speed. Random activity stays at screen edges; observation visits remain separate.
- Full English README with setup/configuration instructions and updated model/skeleton demos. Application menus remain Chinese.

## Downloads / 下载

- **Mac**: `Xiaojing-0.6.1-macOS-arm64.dmg` — Apple Silicon, macOS 14+. Drag the app into Applications. Settings: 🐳 menu bar icon.
- **Windows**: `Xiaojing-0.6.1-Windows-x64.exe` — Windows 10/11 x64 portable preview. Settings: system tray.
- `INSTALL.txt`: quick start in Chinese and English. `SHA256SUMS.txt`: package checksums.

[中文使用说明](https://github.com/Tao-617/ai-whale-doll/blob/main/README.md) · [English setup guide](https://github.com/Tao-617/ai-whale-doll/blob/main/README.en.md)

Mac 包未做 Apple 公证；Windows 包未正式签名，在 Mac 上交叉构建，尚未在真实 Windows 桌面验收。更新 Mac 临时签名包后可能需要重新授予录屏权限。AI 功能需要自己的模型服务，观察每次启动默认暂停。

The Mac package is not Apple-notarized. The Windows package is unsigned and cross-built on Mac; real Windows desktop testing is still pending. Updating the ad-hoc signed Mac app may require granting screen recording access again. AI features require your own model service; observation starts paused on each launch.
