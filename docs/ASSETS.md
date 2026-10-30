# 角色素材格式

本仓库不包含角色动画。准备你有权使用的透明动画 WebP，并在同一目录创建 `素材清单.json`。

```json
{
  "character": "我的虚拟主播",
  "idle": {
    "id": "idle",
    "file": "idle.webp",
    "name": "待机",
    "durationMs": 4500
  },
  "variants": [
    {"id": "01", "file": "wave.webp", "name": "招手", "durationMs": 4500},
    {"id": "17", "file": "snack.webp", "name": "偷吃", "durationMs": 5800},
    {"id": "18", "file": "celebrate.webp", "name": "庆祝", "durationMs": 4500},
    {"id": "20", "file": "heart.webp", "name": "比心", "durationMs": 4750}
  ]
}
```

以上文件名仅为示例，需自行提供真实图片。`idle` 必须存在；其他动作缺失时相关功能会回到待机或不执行。建议至少提供招手、庆祝、比心和偷吃，便于使用默认互动规则。

动作 ID 允许字母、数字、下划线和短横线；文件必须是素材目录内实际存在的 `.webp`。程序拒绝越界路径，只公开清单中的文件。可用 `playbackFile` 指定替代播放文件。

兼容字段还包括 `additionalIdleAnimations`、`workAnimations` 数组，以及 `dragAnimation`、`landingAnimation`、`quotaAnimation` 对象。

```sh
python3 tools/mac_studio.py --assets /绝对路径/素材包 --open
```

程序可只读发现本机 BailongEnhanced 的素材目录；不会移动角色文件或修改桌宠设置。任意动画素材的授权都由使用者自行确认，尤其是公开直播与商业使用。
