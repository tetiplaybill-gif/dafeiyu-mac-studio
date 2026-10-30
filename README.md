# 小龙娘直播工作台 · macOS 源码版

在 Mac 上运行的本地 AI 虚拟主播工作台：角色动画、中文语音、抖音评论回复、进场欢迎、礼物加时与空闲小动作。

从 [大肥鱼 AI 虚拟主播](https://github.com/zbsdsb/dafeiyu-ai-vtuber) 的 Mac 适配中独立整理，沿用 **GPL-3.0**。这是可修改的源码，不是打包安装器；**不包含小龙娘角色素材、API 密钥、账号登录状态或直播记录**。

<img src="Live2D/macos/room-depth.png" alt="工作台使用的预渲染房间背景，不含角色" width="240">

## 功能与验证范围

| 功能 | 当前状态 |
| --- | --- |
| 竖屏场景、字幕、现有透明 WebP 角色动画 | Mac 实测 |
| OpenAI 对话和自然中文语音；Mac 本地语音备选 | Mac 实测，需要自己的服务权限 |
| 真实抖音评论 → AI 回复 → 本机语音 | 已在真实房间验证 |
| 真实进场 → 中文欢迎＋招手 | 已在真实房间验证 |
| 空闲时随机偷吃、比心、困倦等动作 | Mac 实测 |
| 礼物采集、连送去重、按规则加时与舞蹈／走位 | 代码和隔离测试通过；等待首份真实礼物端到端验收 |
| 观众端声音、推流画质、平台权限 | 需要使用者在自己的直播环境确认 |

背景是预渲染图片加视差；角色是已有整段动画，不是可任意驱动的 3D 或 Live2D 骨骼，也没有逐音素嘴型同步。

## 运行条件

- macOS、Python 3.9+。主工作台使用 Python 标准库和系统的 `say`、`afconvert`、`afplay`。
- 你有权使用的透明动画 WebP 素材包，见 [素材格式](docs/ASSETS.md)。支持读取本机已安装的 BailongEnhanced 素材，或用 `--assets` 指定目录。
- 自然语音首次使用会调用已有的 `xcrun swiftc` 编译原生组件，需要 Xcode Command Line Tools。没有该组件时可选择 Mac 本地语音。
- 抖音采集需要 Node.js 22+、Playwright，以及位于 `/Applications/Google Chrome.app` 的 Chrome。

启动器会优先寻找本机已有的运行时，不会自动安装软件。无 Codex 环境也可使用 PATH 中的 Node；在仓库根目录自行准备采集依赖：

```sh
npm install --no-save --package-lock=false playwright@1.62.1
```

此版本使用已安装的 Chrome，不需要 `playwright install` 下载浏览器。离线测试不需要 Playwright、Chrome、角色素材或 API 密钥。

## 启动

```sh
git clone https://github.com/tetiplaybill-gif/dafeiyu-mac-studio.git
cd dafeiyu-mac-studio
python3 tools/mac_studio.py --assets /你的素材目录 --open
```

若已安装可识别的 BailongEnhanced 素材，也可双击 `启动小龙娘主播.command`，或省略 `--assets`。Finder 启动脚本使用 `/usr/bin/python3`；若你的 Python 在其他位置，请用上面的终端命令。

- 工作台：<http://127.0.0.1:18766/>
- 9:16 纯净舞台：<http://127.0.0.1:18766/stage>

在本机「声音与模型」中保存自己的 OpenAI API 密钥。密钥仅保存在进程内存中，退出后需重新输入，不写配置文件或浏览器存储。本版保留 `gpt-6.1-terra` 对话模型及 `gpt-realtime-2.1-mini` 自然语音模型；需要账号有相应 API 权限。模型标识与语音选项分别在 `tools/mac_studio.py`、`tools/mac_voice.py`。

选择 Mac 本地语音可先体验离线播报；对话、自然语音和自动互动产生相应 API 用量。程序不会自动重试失败的模型或语音请求。

## 接入直播间

保持主工作台运行，另开终端执行：

```sh
python3 tools/mac_danmaku_launch.py --open
```

也可双击 `接入抖音弹幕.command`。在工作台的采集面板填写自己的公开房间链接或房间号，点击连接。采集面板也可单独打开 <http://127.0.0.1:18768/>。

采集器打开一个静音 Chrome 窗口。保持窗口运行；如平台要求登录或验证，直接在该窗口正常操作，不需要提交 Cookie。普通浏览器负责平台连接与重连，程序读取收到的消息；没有自己实现签名或登录绕过。

四个开关分别控制评论回复、进场欢迎、空闲动作和真实礼物。修改后点击「应用」。可用 `--observe` 以全部自动互动关闭的状态启动采集器。

详细的欢迎节流、连送去重、倒计时、动作边界和直播声音配置见 [使用说明](docs/USAGE.md)。

## 测试

```sh
python3 -m unittest discover -s tests/macos -v
node --test tests/macos/test_danmaku.cjs tests/macos/test_host_activity.cjs tests/macos/test_gifts.cjs
```

当前为 **23 项 Python + 29 项 Node 离线测试**。测试使用合成协议数据与隔离工作台，不访问直播平台、不播放声音、不调用付费 API。公开副本已替换开发时使用的真实房间标识。

## 来源、素材与隐私

- 上游来源、版本和改动范围见 [NOTICE.md](NOTICE.md)，代码许可证见 [LICENSE](LICENSE)。
- 角色素材需要另行取得相应授权；代码开源不授予任何角色、声音或模型的使用权。本仓库不分发原版大肥鱼模型或本机小龙娘素材。
- 已包含的房间背景是生成图片，来源与提示词见 [ARTWORK.md](Live2D/macos/ARTWORK.md)。
- 所有服务只监听本机。`out/` 包含音频、浏览器会话和去重记录，不应公开或上传。主舞台总数可能包含手动排练；采集面板单独显示真实来源的事件数量，不代表收入。
- 使用时保留画面的 AI 角色／合成语音标识，并自行确认平台规则和观众端音频。

问题反馈请提供已去除账号信息和凭据的复现步骤；不要上传密钥、Cookie、浏览器 Profile 或真实聊天记录。
