# 插件 API（Plugin v1）

插件用来给桌宠加一点「会自己动」的小功能，例如番茄钟、喝水提醒。插件不会碰宠物的渲染循环：它运行在独立的沙箱 iframe 里，只能通过 `postMessage` 请求宿主做事。

## 目录结构

```text
my-plugin/
├─ plugin.json
└─ plugin.html
```

`plugin.json` 引用的入口文件必须位于插件目录内，扩展名为 `.html`，不允许 `../` 或绝对路径。

## 安装位置与导入

- 内置插件：`public/plugins/<id>/`，随应用打包，目前有 `pomodoro`（番茄钟）和 `water`（喝水提醒）。
- 导入的插件：`%APPDATA%\com.vineturtle.vinepalmapet\plugins\<id>\`。
- 打开方式：托盘菜单或桌宠右键菜单 →「设置…」→「插件」卡片 →「导入插件 ZIP」。
- 压缩包里的 `plugin.json` 可以在根目录，也可以位于唯一的顶层文件夹中。
- 限制：解压后 ≤64 MB、≤512 个文件，拒绝 `../` 路径；同一个 `id` 会覆盖旧版本。
- 内置插件的 id（`pomodoro`、`water`）不能被导入包覆盖，也不能删除。

导入成功后会自动启用，并通知宠物窗口重新加载插件列表。删除插件会先停用它，再移除目录。

## plugin.json

```jsonc
{
  "schema": 1,
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "description": "可选说明",
  "author": "your name",
  "permissions": ["pet.say", "pet.state"],
  "entry": "plugin.html"
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `schema` | ✅ | 固定为 `1` |
| `id` | ✅ | 小写字母、数字、`-`、`_`，同时作为目录名和存储命名空间 |
| `name` | ✅ | 显示名称 |
| `version` | 建议 | 显示在设置窗口，修改版本号会让 iframe 重新创建 |
| `description` / `author` | 建议 | 设置窗口里展示 |
| `permissions` | | 需要的能力，见下表；未申请的调用会被拒绝 |
| `entry` | | 入口 HTML，默认 `plugin.html`，必须是包内的 `.html` 文件 |

## 权限

| 权限 | 允许的调用 | 说明 |
| --- | --- | --- |
| `pet.say` | `VinePlugin.say()` | 让桌宠说一句话 |
| `pet.state` | `VinePlugin.setState()` | 请求切换动画状态 |
| `pet.read` | `VinePlugin.getPet()` | 读取当前宠物 id、状态、缩放 |
| `config.read` | `VinePlugin.getConfig()` | 读取显示相关设置 |

存储（`VinePlugin.storage`）始终可用，不需要声明权限，但只能读写当前插件自己的命名空间。

## 运行环境

- 插件页面通过 `srcdoc` 注入 `sandbox="allow-scripts"` 的 iframe；没有 `allow-same-origin`，因此运行在**不透明源**中。
- 插件无法访问 Tauri API、宿主的 DOM、Cookie / localStorage，也不能导航宿主窗口。
- 插件可以使用 `setTimeout`、`setInterval`、`fetch`（受 WebView2 网络策略限制）、`postMessage` 等浏览器能力。
- 插件抛出的异常只影响自己的 iframe，宠物的渲染、拖拽和气泡不受影响。

## API

宿主会在插件脚本之前注入 `window.VinePlugin`。

### 生命周期

```js
VinePlugin.onReady((info) => {
  // info.manifest / info.permissions / info.storage / info.pet
});
```

- `onReady(handler)`：握手完成后调用；如果已经就绪会立即执行。
- `VinePlugin.isReady`：是否已完成握手。
- `VinePlugin.info`：握手信息。

`info` 的形状：

```jsonc
{
  "manifest": {
    "id": "my-plugin",
    "name": "我的插件",
    "version": "1.0.0",
    "description": null,
    "author": null,
    "permissions": ["pet.say"]
  },
  "permissions": ["pet.say"],
  "storage": { "lastReminder": 1730000000000 },
  "pet": { "id": "vine", "state": "idle", "scale": 1 }
}
```

### 说话

```js
VinePlugin.say("该喝水啦 💧", 4200);
```

- 文本会去掉首尾空白，最长 200 个字符。
- `duration` 会被限制在 800–15000 毫秒，默认 3800。
- 需要 `pet.say` 权限；气泡会正常显示，但 `talk` 动画只在 `idle` 时生效，`focus` / `sleep` / `pat` 等状态不会被说话打断。
- 如果设置里关闭了气泡，会改为播放约 1.2 秒的静音 `talk` 动画。

### 切换状态

```js
VinePlugin.setState("focus");
```

- 允许的状态：`idle`、`pat`、`celebrate`、`focus`、`sleep`、`talk`。
- 需要 `pet.state` 权限。
- 低优先级状态不能打断高优先级状态，宿主会返回错误。
- 唯一例外：`setState("idle")` 可以主动结束 `focus`（番茄钟休息时使用）。`sleep`、`pat` 不会被插件打断。

### 读取状态

```js
const pet = await VinePlugin.getPet();      // 需要 pet.read
const config = await VinePlugin.getConfig(); // 需要 config.read
```

`getConfig()` 只返回 `petId`、`scale`、`alwaysOnTop`、`muted`、`bubbleEnabled`，不暴露窗口坐标等内部信息。

### 存储

```js
await VinePlugin.storage.set("count", 1);
const count = await VinePlugin.storage.get("count");
const all = await VinePlugin.storage.all();
await VinePlugin.storage.set("count", null); // 删除这个键
```

- 键：1–64 个字符；值：`string` / `number` / `boolean` / `null`。
- 单个字符串最长 2000 个字符，每个插件最多 64 个键。
- 数据保存在 `config.json` 的 `plugins.data.<id>` 下，按插件 id 隔离。
- 写入由 Rust 侧做单键合并，不会覆盖其他插件的设置或已启用列表。

### 事件

```js
const off = VinePlugin.on("pet:state", (payload) => {
  // payload.state / payload.petId
});

VinePlugin.on("plugin:test", () => {
  // 用户在设置窗口点了「试一下」
});
```

- `init`：握手完成（也会触发 `onReady`）。
- `pet:state`：宠物动画状态变化时推送 `{ state, petId }`。
- `plugin:test`：设置窗口的「试一下」按钮；参数为 `null`。
- `on(event, handler)` 返回取消订阅函数。

### 通用调用

```js
await VinePlugin.call("storage.get", { key: "count" });
```

`call()` 是上面所有方法的底层形式。未知方法、缺少权限或参数非法时 Promise 会 reject。

## 宿主限制

| 限制 | 值 |
| --- | --- |
| 调用频率 | 每个插件 20 次 / 秒，超出会 reject |
| 气泡文本 | 200 字符 |
| 气泡时长 | 800–15000 毫秒 |
| 状态白名单 | 见「切换状态」 |
| 存储 | 每插件 64 个键，单值 2000 字符 |

宿主会校验每条消息的 `event.source` 是否属于已加载的插件 iframe，忽略未知格式的消息。

## 完整示例

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>Hello</title>
  </head>
  <body>
    <script>
      VinePlugin.onReady(async (info) => {
        const count = (await VinePlugin.storage.get("count")) ?? 0;
        await VinePlugin.storage.set("count", count + 1);
        VinePlugin.say(`这是第 ${count + 1} 次打招呼 🌱`, 3000);
      });

      VinePlugin.on("plugin:test", () => {
        VinePlugin.say("插件运行正常！", 3000);
      });
    </script>
  </body>
</html>
```

## 调试

- 设置窗口启用插件后，宠物窗口里会出现一个 1×1 的隐藏 iframe（在开发者工具 Elements 面板中可见）。
- 插件里的 `console.log` 会出现在 iframe 自己的控制台。
- 打开宠物窗口的 DevTools（Tauri 开发模式下右键 →「检查」）可以查看宿主侧的 `[plugin]` 日志和权限错误。
- 插件的加载、权限或入口文件错误不会让宠物消失；设置窗口会显示导入/删除失败的提示。

## 安全边界

- 插件页面没有 Tauri 权限，不能调用任何 `invoke`。
- 插件只能请求清单里声明过的能力；`storage` 仅限自身 id。
- 插件发送的文本、状态、时长和频率都会被宿主裁剪。
- 删除插件会同时移除其目录；存储数据会保留在配置中，重新安装同 id 插件后仍可读取。
