# 第三方组件与素材来源

以下来源说明不改变各部分原有的许可。本项目暂未给自有代码和角色素材指定统一开源许可证。

- **Three.js 0.180.0**：MIT；随仓库保留 [完整许可](web/vendor/THREE-LICENSE.txt) 与 [文件来源清单](web/vendor/manifest.json)。来源为 [mrdoob/three.js](https://github.com/mrdoob/three.js/tree/r180)。
- **动画示例**：`web/assets/anims/Xbot.glb`、`Soldier.glb`、`Michelle.glb` 来自 [Three.js 官方 glTF 示例素材](https://github.com/mrdoob/three.js/tree/r180/examples/models/gltf)，使用其中的动画片段并在运行时重定向到小鲸骨架。原有模型、动画的权利归各自作者；本项目未为这些第三方素材另行授予许可。
- **Electron / electron-builder**：Windows 外壳的依赖，版本固定在 `desktop/windows/package-lock.json`。来源分别为 [electron/electron](https://github.com/electron/electron) 与 [electron-userland/electron-builder](https://github.com/electron-userland/electron-builder)。Electron 分发所附的 LICENSE 与 Chromium 许可文件保留在 Windows 应用资源中。
- **Node.js**：Mac 安装包包含 Node 24 运行时，其完整许可随应用放在 `Contents/Resources/Node-LICENSE.txt`；来源为 [nodejs/node](https://github.com/nodejs/node)。
- **小鲸模型**：项目内通过 Tripo 生成并进行骨架、权重、表情和材质调整；这里保留运行时 GLB，不包含原始制作工程或视频参考。

本项目为个人桌宠实验，与 DeepSeek、上述依赖或素材提供方不存在官方合作或背书关系。
