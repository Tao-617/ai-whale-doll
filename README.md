# 小鲸 · AI Whale Doll

一个会沿屏幕边缘走动、攀爬、做小动作，并可选使用 AI 聊天和截图点评的 3D 桌宠。

当前版本 **0.6.0 测试版**：Mac 已在本机启动验证；Windows 安装包由 Mac 交叉构建，尚待真实 Windows 桌面验收。

## 下载

普通使用者请到 [Releases 下载页](https://github.com/Tao-617/ai-whale-doll/releases/tag/v0.6.0) 下载安装包，无须下载源码。

| 平台 | 文件 | 要求 |
| --- | --- | --- |
| Mac | [Xiaojing-0.6.0-macOS-arm64.dmg](https://github.com/Tao-617/ai-whale-doll/releases/download/v0.6.0/Xiaojing-0.6.0-macOS-arm64.dmg) | M 系列芯片，macOS 14 及以上；不支持 Intel Mac |
| Windows | [Xiaojing-0.6.0-Windows-x64.exe](https://github.com/Tao-617/ai-whale-doll/releases/download/v0.6.0/Xiaojing-0.6.0-Windows-x64.exe) | Windows 10/11 x64；免安装测试版 |

模型、动画和运行依赖都在包内，不需要另装 Node 或 Python。Mac 打开 DMG 后将 Xiaojing 拖入 Applications；Windows 双击 EXE。Mac 设置在顶部菜单栏鲸鱼图标中，Windows 设置在右下角系统托盘中。

安装包尚未做 Apple 公证或 Windows 商业代码签名，首次运行可能出现系统拦截。Mac 的受信任应用手动打开流程见 [Apple 官方说明](https://support.apple.com/en-us/102445)。详细操作见 [使用说明](docs/install-0.6.txt)。

## 可以做什么

- 沿屏幕四周随机左右走、上下爬，停下时做小动作，偶尔用气泡闲聊。
- 抓取、拖动、从下方向上提时倒立；抓着转圈会转晕、吐小泡沫。
- 三档大小，调整大小后自动归到边缘；可以暂停自由活动。
- 可选 AI 文字聊天，允许的窗口有新操作时，每分钟尝试观察一次。
- 截图后的主动移动独立于随机游走：模型找到明确关注点时，可以暂时走到内容旁说话，结束后返回边缘。

## AI 配置与观察

本地走动、拖拽、小动作和随机闲聊不需要 API Key。AI 功能需要在「模型设置」里填写支持图片的 Anthropic Messages 兼容 HTTPS 服务地址、模型名称及自己的 API Key；服务商可能收费。

观察默认暂停、允许名单默认空。使用者选择愿意让模型查看的应用后开启观察，Mac 还需授予录屏权限。停止操作至少 4 秒、窗口稳定至少 8 秒、最近一分钟有键鼠活动时，才会按一分钟间隔尝试观察。

只查询键鼠活动间隔，不记录键盘字符或剪贴板。截图只针对允许的前台窗口，并发送到使用者配置的模型服务；聊天和截图不写本地日志。截图和文字可能包含敏感内容，请自行选择允许的应用。网络结果不确定时自动暂停，不自动重试请求。

Mac 密钥保存在钥匙串，Windows 通过系统加密保存。公开仓库及安装包不包含开发者密钥或个人应用名单。

## 从源码运行

网页预览使用 Python 3，无构建步骤：

```sh
python3 scripts/serve.py
```

打开 <http://127.0.0.1:8812/>。网页预览展示模型与动作；系统托盘、桌面窗口、全局拖动和观察功能由桌面外壳提供。

Mac 构建需要 Xcode Command Line Tools，以及通过 nvm 安装并启用的 Node 24（构建脚本同时复制 Node 安装目录中的 LICENSE）：

```sh
sh desktop/build.sh
sh desktop/package-mac.sh
```

生成的 DMG 在 `desktop/dist/`。构建脚本按当前机器架构生成应用；发布页当前只有 Apple Silicon 版本。自行构建后也请在模型设置里配置服务，`companion/worker.py` 仅保留原作者工作区的开发兼容入口；公开版本通过 `companion/node-worker.cjs` 独立调用配置的服务。

Windows 使用 Node 24 构建，详见 [Windows 开发说明](desktop/windows/README.md)：

```sh
cd desktop/windows
npm ci
npm test
npm run pack
```

## 验证与限制

Swift 几何／缩放检查 7,743 项、观察策略检查 24 项，Python worker 检查 9 项，Windows Node 测试 10 项通过。三档尺寸的攀爬、走路切换、气泡后归边已在浏览器渲染中验证。模型关注点由 AI 判断，可能不准确。

可在项目根目录运行离线检查：

```sh
swiftc desktop/Roaming.swift tests/roam_policy.swift -o /tmp/xj-roam
/tmp/xj-roam
swiftc desktop/ObservationPolicy.swift tests/policy.swift -o /tmp/xj-policy
/tmp/xj-policy
python3 -m unittest discover -s tests -p 'test_*.py'
node --test desktop/windows/test/*.test.cjs
```

Windows 的透明窗口、托盘、不同 DPI 显示器和 PrintWindow 截图兼容性仍需实机确认；无法截图的窗口会跳过，不改为截取整个屏幕。Windows 暂无 Mac 壁纸模式。当前没有语音功能。

## 目录与素材

`web/` 是 Three.js 渲染与交互，`desktop/` 是 Mac 原生外壳，`desktop/windows/` 是 Windows Electron 外壳，`companion/` 是 AI 请求协议，`tests/` 是离线检查。下载的视频参考、原始模型工程、个人开发记录和构建缓存不在公开仓库中。

第三方组件与动画来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。项目自有代码和角色素材暂未指定统一开源许可证。
