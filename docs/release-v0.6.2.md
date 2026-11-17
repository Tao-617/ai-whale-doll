# 小鲸 / Xiaojing 0.6.2 · Preview

- 更安静：通常隔 2–4 分钟才散步一次，休息时可以更久。
- 偶尔在底边跳约 8 秒桑巴舞，再继续休息；两次至少间隔 8 分钟。
- 新增蹲下抱头发呆、坐下吃白饭、侧躺睡觉；可自动选择，也可从「休息动作」菜单选择。饭碗、米饭和勺子由程序生成，不需要额外建模资源。
- 应用中英文切换：菜单／托盘 → **Language / 语言**。菜单、聊天界面、本地闲聊和 AI 回复跟随选择，并保存偏好。
- 修复贴边：按角色可见轮廓计算位置，避免透明窗口的留白让她站得太靠里。主动观察说完后优先返回边缘，再继续休息。
- 中英文 README 更新了操作说明与 15 秒休息动作演示。

- Quieter activity: walks are usually 2–4 minutes apart, sometimes longer while resting.
- An occasional eight-second samba at the bottom edge, followed by rest; dances are at least eight minutes apart.
- New resting poses: crouch and brood, sit and eat rice, or lie down and sleep. Choose them under **Resting poses**, or let her choose while idle. The bowl, rice, and spoon are procedural meshes.
- **Language / 语言** switches menus, chat controls, local chatter, and AI replies between English and Simplified Chinese. The preference is remembered.
- Edge placement follows the visible character rather than the transparent window padding. After an intentional observation visit, returning to an edge takes priority over idle activities.
- Updated Chinese/English guides and a 15-second resting demo.

## Downloads / 下载

- **Mac**: `Xiaojing-0.6.2-macOS-arm64.dmg` — Apple Silicon, macOS 14+. Drag Xiaojing into Applications. Settings: 🐳 menu bar icon.
- **Windows**: `Xiaojing-0.6.2-Windows-x64.exe` — Windows 10/11 x64 portable preview. Settings: system tray.
- `INSTALL.txt`: bilingual quick start. `SHA256SUMS.txt`: package checksums.

[中文使用说明](https://github.com/Tao-617/ai-whale-doll/blob/main/README.md) · [English setup guide](https://github.com/Tao-617/ai-whale-doll/blob/main/README.en.md)

Mac 包未做 Apple 公证；Windows 包未正式签名，尚未在真实 Windows 桌面验收。AI 需要配置自己的模型服务，观察每次启动默认暂停。本次测试未调用付费模型。

The Mac package is not Apple-notarized. The Windows package is unsigned; real Windows desktop testing is still pending. AI requires your own model service, and observation starts paused on each launch. This release was tested without paid model calls.
