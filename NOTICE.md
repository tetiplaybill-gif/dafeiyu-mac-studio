# 来源与改动说明

本仓库是 `dafeiyu-ai-vtuber` 的独立 macOS 源码适配，非上游官方发行版。

- 直接上游：[zbsdsb/dafeiyu-ai-vtuber](https://github.com/zbsdsb/dafeiyu-ai-vtuber)
- 基础提交：[`fa93c083cae4b08af0f7e11bd9cad9c36e182414`](https://github.com/zbsdsb/dafeiyu-ai-vtuber/commit/fa93c083cae4b08af0f7e11bd9cad9c36e182414)
- 上游声明的来源：[Ikaros-521/AI-Vtuber](https://github.com/Ikaros-521/AI-Vtuber)
- 本次独立源码整理日期：2026-10-30

保留上游完整 GNU GPL version 3 许可证。此适配代码沿用 GPL-3.0；原有作者和贡献者的权利保留。上游其他组件、素材和商业使用说明应查阅其各自来源，本仓库不会扩展其授权。

本次改动：新增 `tools/mac_studio.py`、`mac_stage.py`、`mac_voice.py`、`mac_realtime_voice.swift` 原生工作台和语音组件；新增 `mac_danmaku.cjs` 及启动器、协议解码、评论/欢迎/礼物调度；新增 `Live2D/macos/` 舞台和控制面板、`tests/macos/` 离线测试、可移植播放计量器。保留的 `protobuf/douyin.proto` 来自上述上游提交；新的解码器依据其中字段实现。

公开副本替换了测试数据中的真实房间标识，把测试的 Python 子进程改为从 PATH 查找 `python3`，并去除了协议文件末尾多余的空行。未包含上游 Windows 主入口、旧弹幕抓取程序、Live2D SDK、原版模型、运行数据或用户本机配置。

小龙娘角色素材不在本仓库中。程序只读取使用者自行提供或已安装的素材；素材的作者标注和使用条件应随原素材保留。原版大肥鱼模型也未分发。代码许可不代替角色、语音和直播平台的许可或使用条件。

随源码提供的房间背景由图像生成工具创建，不含角色；生成提示词记录于 `Live2D/macos/ARTWORK.md`。
