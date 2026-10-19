# WILDLANDS · 无垠之境

基于 **Babylon.js** 的可游玩、零构建的浏览器 3D 开放世界探索原型。**没有任何建筑**。

## 功能

- 无限延伸的确定性地形 Chunk：玩家接近时生成，离开后卸载（此为流式生成原型，不是大规模商业级地形系统）。
- 草原、山脊、松树、阔叶树、湖面、云朵及昼夜光照。
- 第三/第一人称切换；键鼠、手机虚拟摇杆、触屏旋转视角。
- 跑步、跳跃、体力；晶石采集及浏览器 `localStorage` 本地存档。
- 基础地形高度行走、树干障碍碰撞、分块资源释放和画质设置。
- 完全静态托管；**无需 Node.js、服务器或构建步骤**就可部署 GitHub Pages。

## 操作

| 平台 | 操作 |
| --- | --- |
| 电脑 | WASD 移动，鼠标观察，Shift 奔跑，Space 跳跃，F 采集，V 切视角，Esc 暂停 |
| 手机 | 左侧摇杆移动；右侧任意空白区域拖动视角；右下角按钮采集、跳跃、奔跑；右上角切视角、设置 |

## GitHub Pages 部署

1. 将本项目所有文件直接放在目标仓库的**根目录**：`index.html`、`src/`、`.nojekyll`、`README.md`。
2. 打开仓库 **Settings → Pages → Build and deployment**，Source 选 **Deploy from a branch**。
3. Branch 选择 **main**，目录选择 **/(root)**，保存。
4. 等待 GitHub Pages 构建完成，进入 `https://<用户名>.github.io/<仓库名>/`。

> 注意：仓库写入和 GitHub Pages 的启用是两个独立操作。仅提交文件不能保证 Pages 已启用。若用私有仓库，还可能受 GitHub 计划和 Pages 可见性限制。

## 本地开发

这是一套原生 ESM 模块，不要直接使用 `file://` 打开（浏览器会对模块文件触发跨域限制）。应启动任意本地 HTTP 服务器：

```sh
python -m http.server 8000
```

访问 `http://localhost:8000`。部署在 GitHub Pages 后则使用 HTTPS。

### 目录

- `index.html` — UI 结构、Babylon.js 引擎入口
- `src/style.css` — UI 样式和触控布局
- `src/main.js` — 游戏循环、角色、相机、输入、日夜、交互
- `src/world.js` — 确定性地形、Chunk、植物、岩石、晶石、存档
- `.nojekyll` — GitHub Pages 关闭 Jekyll 处理

## 技术与限制

- **引擎**：Babylon.js（浏览器通过 `https://cdn.babylonjs.com/babylon.js` 加载），没有使用 Three.js、PlayCanvas、Godot。
- **开发语言**：模块化 JavaScript（兼容浏览器直接运行）。可在后续迁移 TypeScript + Vite。
- **物理**：目前是自写的轻量角色高度采样、跳跃和简单树木水平碰撞。**尚未接入 Havok**，也没有完整斜坡步态、连续碰撞检测或布娃娃物理。
- **存档**：采集状态仅存于当前浏览器的 `localStorage`，清除网站数据后会丢失。
- **在线**：访问游戏需要网络获取 Babylon.js CDN；除引擎之外游戏资源均本地生成。
- **性能**：手机默认低加载范围和较低像素比例；设备性能因 GPU/浏览器差异显著。尚无真机 FPS 基准测试。
- **开放世界**：地形生成由全局固定种子控制，相同世界坐标生成相同地形。世界极远处仍受浮点精度限制。
- **资源**：当前只是可扩展原型，不含建筑、NPC、联机、任务或背包 UI。

## 开发下一步

优先接入 Havok Character Controller，加入分级地形 LOD / Instancing 批处理、真正的物体交互与移动端实机性能分析。