# VinePalmaPet 🌱

一只住在桌面上的 2D 宠物。

VinePalmaPet 用 **Tauri 2 + React + TypeScript** 构建：透明无边框窗口、帧动画状态机、像素级点击穿透、可导入的宠物包，以及一套沙箱化的插件系统。它不读取屏幕内容、不上传数据、不消耗模型 Token。

> 状态：**M5 打包与打磨** — 宠物包、GIF 导入、沙箱插件、开机自启和 NSIS 安装包均已就绪。

---

## 目录

- [当前进度](#当前进度)
- [特性](#特性)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [宠物包格式](#宠物包格式)
- [插件系统](#插件系统)
- [开发脚本](#开发脚本)
- [路线图](#路线图)
- [许可证](#许可证)

---

## 当前进度

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| M0 | Tauri 脚手架、透明窗、托盘、配置读写 | ✅ |
| M1 | 帧动画、状态机、拖拽、吸附、位置/大小记忆 | ✅ |
| M2 | 点击穿透、气泡、右键菜单、音效 | 🚧 穿透/气泡/菜单完成，音效待做 |
| M3 | GIF 导入、宠物包导入/切换、设置窗口 | ✅ |
| M4 | 插件宿主 + API + 内置插件 | ✅ |
| M5 | 开机自启、多显示器打磨、安装包 | ✅ |
| M6 | 文档、模板、示例 | ✅ |

## 特性

- **透明悬浮**：无边框、置顶、不占任务栏，关闭窗口后留在托盘继续运行。
- **像素级点击穿透**：只有宠物身体会拦截鼠标，透明区域可以直接点到下面的桌面/软件。
- **帧动画状态机**：待机、眨眼、摸摸头、专注、睡觉、说话；高优先级动作不会被打断，切换时带“下压→回弹”过渡。
- **拖拽与吸附**：按住宠物拖动窗口，松手自动吸附屏幕边缘，并记住位置。
- **大小可调**：60% – 160%，缩放时保持脚底锚点不动。
- **宠物包驱动**：所有动画、状态、帧率都由 `pet.json` 描述，换宠物不需要改代码。
- **导入自己的宠物**：设置窗口支持导入 zip 宠物包，也可以直接把一张 GIF 转成宠物；导入的包保存在应用数据目录，随时切换或删除。
- **插件扩展**：插件运行在 `sandbox="allow-scripts"` 的 iframe 中，能力需在清单里声明并由宿主逐条校验；内置番茄钟与喝水提醒，可导入 ZIP 插件。
- **开机自启**：设置里一键注册到当前用户的 Windows 启动项，登录后自动在托盘运行。
- **多显示器友好**：启动时把窗口收回最近的显示器工作区，即使上次保存的位置所在显示器已断开也不会“消失”。
- **互不打扰**：插件异常、宠物包损坏都只影响自己，宠物窗口始终保留可用状态。

## 快速开始

### 环境要求

- Windows 10/11（当前仅在 Windows 上验证）
- Node.js ≥ 20（本项目使用 Node 24）
- Rust ≥ 1.77（含 MSVC 工具链）
- WebView2 Runtime（Windows 11 自带）

### 安装与运行

```bash
npm install
npm run tauri:dev
```

首次启动会编译 Rust 依赖，需要几分钟；之后是增量编译。

### 打包

```bash
npm run tauri:build
```

产物在 `src-tauri/target/release/bundle/nsis/`。

安装包按当前用户安装（不需要管理员权限），支持简体中文 / English 安装界面。安装后在设置窗口打开「开机自启」，即可让应用随 Windows 登录启动。

> 首次打包会从 GitHub 下载 NSIS 工具链（约 30 MB）。如果下载超时，可先设置代理再重试，例如 PowerShell 中 `$env:HTTPS_PROXY='http://127.0.0.1:7890'`。

> 只调前端时可以 `npm run dev` 在浏览器中打开 `http://localhost:1420`。窗口拖拽、穿透、托盘等桌面能力在浏览器里会自动降级为 no-op，宠物本身仍可预览。

### Node 路径提示

如果 PowerShell 里 `node` 不在 PATH（例如 Node 装在 `C:\nodejs\node-v24.22.2`），运行前先：

```powershell
$env:Path = "C:\nodejs\node-v24.22.2;$env:Path"
```

## 项目结构

```text
VinePalmaPet/
├─ src/
│  ├─ app/                  应用壳
│  ├─ pet/                  渲染引擎、状态机、气泡、菜单
│  ├─ packs/                宠物包加载与校验
│  ├─ plugins/              插件清单、沙箱 iframe 宿主与 RPC
│  ├─ platform/             Tauri 桌面能力封装（拖拽/穿透/吸附）
│  ├─ settings/             设置窗口（宠物包 / 插件 / 显示选项）
│  ├─ store/                配置持久化
│  └─ styles.css
├─ src-tauri/               Rust 侧：透明窗、托盘、配置读写、包与插件导入
├─ public/pets/vine/        内置占位宠物包
├─ public/plugins/          内置插件（pomodoro / water）
├─ scripts/                 素材生成 / 宠物包与插件打包
├─ docs/                    宠物包与插件文档
├─ examples/                可导入的宠物包 / 插件模板
└─ src-tauri/tauri.conf.json
```

### 配置位置

```text
%APPDATA%\com.vineturtle.vinepalmapet\
├─ config.json      # 缩放、置顶、宠物 ID、窗口坐标、插件开关与存储
├─ pets\<id>\       # 导入的宠物包
└─ plugins\<id>\    # 导入的插件
```

设置窗口可以从托盘菜单的「设置…」或桌宠右键菜单的「设置…」打开。

## 宠物包格式

一个宠物包是一个文件夹（或 zip），至少包含 `pet.json` 和若干横向图集：

```text
pets/vine/
├─ pet.json
├─ idle.png      # 8 帧 × 256px
└─ blink.png
```

```json
{
  "schema": 1,
  "id": "vine",
  "name": "Vine",
  "author": "VineTurtleStudio",
  "license": "CC-BY-4.0",
  "frame": { "width": 256, "height": 256 },
  "anchor": { "x": 0.5, "y": 1.0 },
  "animations": {
    "idle": { "file": "idle.png", "frames": 8, "fps": 7, "loop": false },
    "blink": { "file": "blink.png", "frames": 4, "fps": 12, "loop": false },
    "happy": { "file": "happy.png", "frames": 12, "fps": 14, "loop": false }
  },
  "states": {
    "idle": { "anims": ["idle", "idle", "blink"], "loop": true, "priority": 0 },
    "pat": { "anims": ["happy"], "next": "idle", "priority": 30 }
  }
}
```

- **图集**：横向排列，帧宽高固定为 `frame.width` / `frame.height`。
- **`states`**：状态机的最小单位。`anims` 会随机抽取，播完按 `next` 跳转或回到 `idle`。
- **`priority`**：数值大的状态可以打断数值小的状态；同级不会互相打断。
- **`idle` 状态必须存在。**
- 内置占位素材由 `scripts/make-placeholder-pet.ps1` 用 GDI+ 生成，仅用于开发预览，可随时替换。

### 导入宠物包

- **导入 ZIP**：压缩包里放一个 `pet.json` 及其图集。`pet.json` 可以在压缩包根目录，也可以在整个压缩包只有一个顶层文件夹时放在该文件夹里。
- **导入 GIF**：选择一张 GIF（≤1024×1024、最多 60 帧），宿主会把它缩放并横向拼接成图集，所有状态共用这段动画。
- 导入的包会安装到 `%APPDATA%\com.vineturtle.vinepalmapet\pets\<id>\`，并立即切换过去。
- 限制：解压后 ≤64MB、≤512 个文件，拒绝 `../` 路径；同一个 `id` 会覆盖旧包。
- 导入的包读取失败时会自动回退到内置的 Vine，不会让宠物窗口空掉。

## 插件系统

设计目标：**功能插件化，本体保持干净**。

- 插件是一个文件夹：`plugin.json` + 一个自包含的 HTML 入口。
- 运行在 `sandbox="allow-scripts"` 的 iframe 中（不透明源），没有 Tauri、宿主 DOM 或本地存储权限。
- 插件通过 `postMessage` RPC 调用宿主；宿主逐条检查清单里声明的权限：`pet.say` / `pet.state` / `pet.read` / `config.read`。
- 文本长度、气泡时长、状态白名单和调用频率都由宿主限制；插件存储按 id 隔离。
- 单个插件异常只会影响自己的 iframe，不会影响宠物渲染和交互。
- 内置插件：**番茄钟**（25 分钟专注 + 5 分钟休息，会保存进度）和**喝水提醒**（启用 5 分钟后首次提醒，之后每 45 分钟一次），默认关闭。
- 设置窗口支持启用/停用、试一下、导入 ZIP 和删除。

插件格式、权限与完整 API 见 **[docs/plugin-api.md](docs/plugin-api.md)**；宠物包格式见 **[docs/pet-pack.md](docs/pet-pack.md)**。可直接导入的模板见 **[examples/](examples/)**。

## 开发脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 只启动 Vite 前端（浏览器预览） |
| `npm run tauri:dev` | 启动完整桌面应用 |
| `npm run build` | TypeScript 检查 + 前端构建 |
| `npm run tauri:build` | 打包安装程序 |
| `powershell -File scripts/make-placeholder-pet.ps1` | 重新生成占位宠物素材 |
| `powershell -File scripts/pack.ps1 -Source <目录> [-Output <zip>]` | 把宠物包或插件目录打包成可导入的 zip |

## 路线图

- [x] 透明悬浮窗 + 托盘
- [x] 帧动画与状态机
- [x] 拖拽、边缘吸附、位置记忆
- [x] 点击穿透与右键菜单
- [x] 气泡对话（音效待补）
- [x] GIF 导入 → 状态机
- [x] 宠物包导入 / 校验 / 切换 / 设置窗口
- [x] 插件沙箱、权限与内置插件
- [x] 开机自启、多显示器打磨
- [x] 安装包（NSIS，当前用户安装）
- [ ] 自动更新
- [x] 文档与插件模板

## 许可证

代码使用 MIT。内置占位素材（`public/pets/vine`）为项目自制，随项目以 CC-BY-4.0 发布；导入第三方宠物包时请遵守其自带许可证。
