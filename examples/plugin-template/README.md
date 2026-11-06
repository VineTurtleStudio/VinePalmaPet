# 插件模板

这是一个可以直接导入的最小插件：`plugin.json` + 自包含的 `plugin.html`。

## 行为

- 第一次加载时通过 `VinePlugin.say()` 打招呼，并用 `VinePlugin.storage` 记住已经打过招呼。
- 设置窗口点「试一下」时，读取当前宠物状态并说一句话，然后请求播放 `celebrate` 动画。
- 只申请了实际用到的权限：`pet.say`、`pet.state`、`pet.read`。

## 试用

1. 在仓库根目录打包：
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\pack.ps1 -Source examples\plugin-template -Output my-plugin.zip
   ```
2. 打开设置窗口（托盘菜单或桌宠右键菜单 →「设置…」）。
3. 在「插件」卡片点「导入插件 ZIP」，选择 `my-plugin.zip`。导入后会自动启用。
4. 点插件行里的「试一下」，桌宠会说话并播放开心动画。

## 改成自己的插件

1. 修改 `plugin.json`：
   - `id`：小写字母、数字、`-`、`_`，同时决定安装目录和存储命名空间。
   - `name` / `version` / `description` / `author`：显示在设置窗口。
   - `permissions`：从 `pet.say`、`pet.state`、`pet.read`、`config.read` 中按需选择；存储不需要声明。
2. 在 `plugin.html` 里写逻辑。页面会被注入到 `sandbox="allow-scripts"` 的 iframe 中，没有 Tauri、宿主 DOM 和 localStorage。
3. 调试时可在插件里 `console.log`，或在宠物窗口开发者工具的宿主日志里查看 `[plugin]` 输出。
4. 重新打包并导入。同一个 `id` 会覆盖旧版本，存储数据会保留。

完整 API、权限和限制见 [docs/plugin-api.md](../../docs/plugin-api.md)。
