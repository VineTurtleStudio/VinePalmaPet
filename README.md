<div align="center">

# VinePalmaPet 🌱

**一只住在桌面上的 2D 宠物**

<a href="#-简体中文">简体中文</a> ·
<a href="#-繁體中文">繁體中文</a> ·
<a href="#-english">English</a> ·
<a href="#-日本語">日本語</a>

</div>

---

## 🇨🇳 简体中文

用 **Tauri 2 + React + TypeScript** 做的桌面宠物：透明无边框窗口、帧动画状态机、像素级点击穿透、可导入的宠物包，以及一套沙箱化的插件系统。

**不读取屏幕内容、不上传数据、不消耗模型 Token。** 它只是一只在桌面上走来走去的小动物，以及一层你可以自己扩展的插件壳。

> 版本形态：2D 图片帧动画（与早期 3D 模型版 `VinePalmaPet-3D-Legacy` 是两套完全不同的实现）。

### 环境要求

| 依赖 | 版本 |
|---|---|
| Node.js | ≥ 20 |
| Rust | ≥ 1.77（Tauri 2 要求） |
| 系统 | Windows 10/11（需 WebView2）· macOS 13+ · Ubuntu 22+ |

### 快速开始

```bash
npm install        # 安装前端依赖
npm run tauri:dev  # 开发模式：打开透明宠物窗口
npm run tauri:build # 打包（Windows 下产出 NSIS 安装包）
```

只想调界面时可以只跑前端：

```bash
npm run dev
```

### 功能

- **透明无边框窗口**：无标题栏、可拖拽、位置与大小记忆
- **帧动画状态机**：待机 / 移动 / 互动等状态自动切换
- **像素级点击穿透**：只有落在宠物身上的点击才被接收，其余交给桌面
- **宠物包导入**：zip 形式的宠物包，含贴图与动作定义；支持 GIF 导入
- **沙箱插件**：插件只能通过声明过的能力访问外部，避免任意文件读写
- **开机自启 + 托盘菜单**
- **多显示器**：跨屏拖动时自动校正位置

### 目录结构

```
src/                前端（React）
  app/              应用壳、窗口与状态管理
  pet/              帧动画与状态机
  packs/            宠物包解析
  platform/         平台相关（点击穿透、自启、托盘）
  plugins/          插件宿主与沙箱
  settings/         设置界面
  store/            持久化
src-tauri/          Rust 侧（窗口、托盘、文件系统）
docs/               文档索引
examples/           示例宠物包
packs/              内置宠物
scripts/            辅助脚本（截图等）
```

### 做一个自己的宠物包

1. 准备一组帧图（PNG，建议固定画布尺寸）
2. 按 `examples/` 里的示例写动作定义
3. 打包成 zip，在设置里导入即可

详见 `docs/` 与 `examples/README.md`。

### 常见问题

- **窗口一片空白**：确认 WebView2 已安装（Win10 老版本可能没有）
- **点击穿透失效**：部分游戏全屏独占模式下会抢占输入，切回窗口模式试试
- **打包体积**：默认 NSIS 安装包；需要绿色版可自行改 `tauri.conf.json` 的 bundle 目标

> 开发细节（里程碑、插件 API、宠物包 schema）见 [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)。

## 🇹🇼 繁體中文

以 **Tauri 2 + React + TypeScript** 製作的桌面寵物：透明無邊框視窗、幀動畫狀態機、像素級點擊穿透、可匯入的寵物包，以及一套沙箱化的外掛系統。

**不讀取螢幕內容、不上傳資料、不消耗模型 Token。** 它只是在桌面上走來走去的小動物，加上一層你可以自行擴充的外掛殼。

### 環境需求

| 依賴 | 版本 |
|---|---|
| Node.js | ≥ 20 |
| Rust | ≥ 1.77（Tauri 2 需求） |
| 系統 | Windows 10/11（需 WebView2）· macOS 13+ · Ubuntu 22+ |

### 快速開始

```bash
npm install
npm run tauri:dev   # 開發模式
npm run tauri:build # 打包（Windows 產出 NSIS 安裝檔）
```

只調介面時可只跑前端：`npm run dev`

### 功能

- **透明無邊框視窗**：可拖曳，記住位置與大小
- **幀動畫狀態機**：待機 / 移動 / 互動自動切換
- **像素級點擊穿透**：只有點在寵物身上才接收事件
- **寵物包匯入**：zip 形式，含貼圖與動作定義，支援 GIF 匯入
- **沙箱外掛**：僅能透過宣告過的能力存取外部
- **開機自啟 + 系統匣選單**
- **多螢幕**：跨螢幕拖曳自動校正位置

### 目錄結構

```
src/                前端（React）
src-tauri/          Rust 端（視窗、系統匣、檔案系統）
docs/               文件索引
examples/           範例寵物包
packs/              內建寵物
scripts/            輔助腳本
```

> 開發細節（里程碑、外掛 API、寵物包 schema）見 [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)。

## 🇬🇧 English

A desktop pet built with **Tauri 2 + React + TypeScript**: transparent frameless window, frame-animation state machine, pixel-perfect click-through, importable pet packs, and a sandboxed plugin system.

**It never reads your screen, never uploads anything, and burns no model tokens.** It is just a small creature walking around your desktop, plus a plugin shell you can extend.

### Requirements

| Dependency | Version |
|---|---|
| Node.js | ≥ 20 |
| Rust | ≥ 1.77 (required by Tauri 2) |
| OS | Windows 10/11 (WebView2) · macOS 13+ · Ubuntu 22+ |

### Quick start

```bash
npm install
npm run tauri:dev    # development window
npm run tauri:build  # bundle (NSIS installer on Windows)
```

Frontend only: `npm run dev`

### Features

- **Transparent frameless window** — draggable, remembers position and size
- **Frame-animation state machine** — idle / walk / interact transitions
- **Pixel-level click-through** — only clicks on the pet itself are captured
- **Pet packs** — zip archives with sprites and action definitions; GIF import supported
- **Sandboxed plugins** — plugins reach the outside world only through declared capabilities
- **Autostart + tray menu**
- **Multi-monitor** — clamps the pet back into view when dragged across screens

### Layout

```
src/                React front end
src-tauri/          Rust side (window, tray, filesystem)
docs/               documentation index
examples/           sample pet packs
packs/              bundled pets
scripts/            helper scripts
```

> Implementation details (milestones, plugin API, pet-pack schema) live in [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md).

## 🇯🇵 日本語

**Tauri 2 + React + TypeScript** 製のデスクトップペットです。透明・枠なしウィンドウ、フレームアニメーションのステートマシン、ピクセル単位のクリック透過、インポート可能なペットパック、サンドボックス化されたプラグイン機構を備えます。

**画面を読まず、データを送信せず、モデルのトークンも消費しません。** デスクトップを歩く小さな生き物と、拡張可能なプラグインの殻です。

### 必要なもの

| 依存 | バージョン |
|---|---|
| Node.js | ≥ 20 |
| Rust | ≥ 1.77（Tauri 2 の要件） |
| OS | Windows 10/11（WebView2）· macOS 13+ · Ubuntu 22+ |

### クイックスタート

```bash
npm install
npm run tauri:dev    # 開発モード
npm run tauri:build  # パッケージ（Windows は NSIS インストーラ）
```

フロントのみ：`npm run dev`

### 機能

- **透明・枠なしウィンドウ** — ドラッグ可、位置とサイズを記憶
- **フレームアニメのステートマシン** — 待機 / 移動 / ふれあい
- **ピクセル単位のクリック透過** — ペット上のクリックだけを受け取る
- **ペットパック** — 画像とアクション定義を含む zip、GIF インポート対応
- **サンドボックスプラグイン** — 宣言した権限でのみ外部にアクセス
- **自動起動 + トレイメニュー**
- **マルチモニタ** — 画面をまたいで移動しても位置を補正

> 実装の詳細（マイルストーン、プラグイン API、ペットパック仕様）は [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)。
---

## 许可 / License

本项目以 [MIT](./LICENSE) 许可证发布。

Licensed under the [MIT License](./LICENSE).
