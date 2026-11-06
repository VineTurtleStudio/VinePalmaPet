# 模板与示例

| 目录 | 用途 |
| --- | --- |
| [`pet-pack-template/`](pet-pack-template/) | 可直接导入的宠物包：`pet.json` + 三张横向图集（待机 / 眨眼 / 开心） |
| [`plugin-template/`](plugin-template/) | 可直接导入的插件：`plugin.json` + 自包含 HTML，演示权限、存储与「试一下」 |

## 打包

两个模板都可以用同一个脚本压成 zip：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\pack.ps1 -Source examples\pet-pack-template -Output my-pet.zip
powershell -ExecutionPolicy Bypass -File scripts\pack.ps1 -Source examples\plugin-template -Output my-plugin.zip
```

脚本会把目录内容放在压缩包根目录，`pet.json` / `plugin.json` 位于顶层，符合导入要求。

## 导入

打开设置窗口（托盘菜单或桌宠右键菜单 →「设置…」）：

- 宠物包：在「宠物包」卡片点「导入 ZIP」，选择 `my-pet.zip`，导入后立即切换。
- 插件：在「插件」卡片点「导入插件 ZIP」，选择 `my-plugin.zip`，导入后自动启用，可点「试一下」验证。

同一个 `id` 会覆盖旧版本。内置宠物 `vine` 和内置插件 `pomodoro` / `water` 不能被覆盖。

格式说明：

- [宠物包格式](../docs/pet-pack.md)
- [插件 API](../docs/plugin-api.md)
