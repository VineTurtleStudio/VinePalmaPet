# 宠物包模板

这是一个可以直接导入的最小宠物包。三张 PNG 来自内置占位素材，仅用于让你先跑通流程。

## 文件

| 文件 | 内容 |
| --- | --- |
| `pet.json` | 清单：尺寸、锚点、动画与状态 |
| `idle.png` | 8 帧待机动画（横向图集） |
| `blink.png` | 4 帧眨眼动画 |
| `happy.png` | 12 帧开心/被摸动画 |

所有图集的每一帧都是 256×256，从左到右排列；`pet.json` 的 `frame` 必须与之一致。

## 试用

1. 在仓库根目录打包：
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\pack.ps1 -Source examples\pet-pack-template -Output my-pet.zip
   ```
2. 打开设置窗口（托盘菜单或桌宠右键菜单 →「设置…」）。
3. 在「宠物包」卡片点「导入 ZIP」，选择 `my-pet.zip`。
4. 导入成功后会自动切换到这个宠物。

## 换成自己的素材

1. 用自己的帧图横向拼接成图集。ImageMagick 示例：
   ```bash
   magick montage frame-*.png -tile 8x1 -geometry +0+0 idle.png
   ```
2. 修改 `pet.json`：
   - `id`：小写字母、数字、`-`、`_`，同时决定安装目录。
   - `name` / `author` / `license`：会显示在设置窗口。
   - `frame`：单帧像素尺寸。
   - `animations.*.frames` / `fps`：图集帧数与播放帧率。
   - `states`：至少要保留 `idle`；`pat`、`celebrate`、`focus`、`sleep`、`talk` 会被宿主主动调用。
3. 重新打包并导入。同一个 `id` 会覆盖旧版本。

完整字段说明见 [docs/pet-pack.md](../../docs/pet-pack.md)。
