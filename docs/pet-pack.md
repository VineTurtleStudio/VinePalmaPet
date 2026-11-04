# 宠物包格式（Pet Pack v1）

宠物包让「换角色」不需要改代码。一个宠物包是一个文件夹，也可以打成 zip。

## 目录结构

```text
my-pet/
├─ pet.json
├─ idle.png
├─ blink.png
└─ happy.png
```

`pet.json` 里引用的文件必须与它同级（不允许 `../`）。所有帧图都是**横向图集**：帧按顺序从左到右排列，每帧宽高一致。

## pet.json

```jsonc
{
  "schema": 1,
  "id": "my-pet",
  "name": "My Pet",
  "author": "your name",
  "license": "CC-BY-4.0",
  "description": "可选说明",
  "frame": { "width": 256, "height": 256 },
  "anchor": { "x": 0.5, "y": 1.0 },
  "bubble": { "x": 0.5, "y": 0.06 },
  "animations": {
    "idle":  { "file": "idle.png",  "frames": 8, "fps": 7,  "loop": false },
    "blink": { "file": "blink.png", "frames": 4, "fps": 12, "loop": false },
    "happy": { "file": "happy.png", "frames": 12, "fps": 14, "loop": false }
  },
  "states": {
    "idle": { "anims": ["idle", "idle", "blink"], "loop": true, "priority": 0 },
    "pat":  { "anims": ["happy"], "next": "idle", "priority": 30 }
  }
}
```

### 顶层字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `schema` | ✅ | 固定为 `1` |
| `id` | ✅ | 小写字母、数字、`-`、`_` |
| `name` | ✅ | 显示名称 |
| `author` / `license` | 建议 | 导入时会展示；请遵守素材授权 |
| `frame` | ✅ | 单帧像素尺寸，所有图集共用 |
| `anchor` | | 角色在画布中的锚点，`{0.5, 1}` = 底部居中 |
| `bubble` | | 气泡相对位置，默认 `{0.5, 0.06}` |
| `animations` | ✅ | 至少一个动画 |
| `states` | ✅ | 必须包含 `idle` |

### animations

| 字段 | 说明 |
| --- | --- |
| `file` | 相对路径，横向图集 |
| `frames` | 帧数 |
| `fps` | 播放帧率 |
| `loop` | `true` 时循环播放；`false` 时播完触发状态切换 |

### states

| 字段 | 说明 |
| --- | --- |
| `anims` | 该状态可选的动画名，每次（重新）进入状态时随机抽取 |
| `loop` | `true` 时播完一个动画后继续从 `anims` 里抽；`false` 且没有 `next` 时回到 `idle` |
| `next` | 一次性动作播完后跳转到的状态 |
| `priority` | 数值越大越优先；低优先级不能打断高优先级（强制切换除外） |

内置状态名（不是强制的，但宿主会主动调用）：`idle`、`pat`、`celebrate`、`focus`、`sleep`、`talk`。

### 让动画“活”起来

- 待机链：把 `idle` 和 `blink` 都放进 `idle` 状态的 `anims`，并把两者的 `loop` 设为 `false`，状态 `loop: true`。每次播完随机抽下一个，就不会是死板循环。
- 一次性反应：`pat` 用 `happy` 动画 + `"next": "idle"`。
- 长时间状态：`focus`、`sleep` 用 `loop: true` 的动画，状态也 `loop: true`。

## 制作图集

1. 导出每一帧 PNG（透明背景，尺寸一致）。
2. 横向拼接成一张长图：
   ```bash
   # ImageMagick 示例
   magick montage frame-*.png -tile 8x1 -geometry +0+0 idle.png
   ```
3. 填写 `frames` 与 `fps`。

> 规划中：`scripts/pack-pet.mjs` 会把一个文件夹或 GIF 自动拼成图集并生成 `pet.json`。

## 校验规则

宿主会拒绝以下情况：

- `schema` 不是 1、缺少 `id` / `name` / `frame`
- 动画的 `frames` / `fps` 非正数，或 `file` 包含 `..`
- 状态引用了不存在的动画
- 缺少 `idle` 状态
- `next` 指向不存在的状态
- 图片无法加载

错误会显示在宠物窗口顶部的错误卡片里，同时输出到控制台。
