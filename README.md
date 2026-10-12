# 微信聊天存档 · Codex Skill

在 Mac 上，把你指定的微信聊天或合并转发记录保存为 Markdown 和可搜索的本地 HTML 阅读页。保留发言人、时间、引用关系、参与者别名和图片文件；继续更新时按消息顺序去重，保留真实的重复发言。

不需要学习 agent，也不需要购买 OCR 服务。Apple Vision OCR 在本机运行。微信操作由你自己的 Codex 桌面能力完成，这个包不读取或解密微信数据库。

## 最简单的安装方法

在支持本地文件与桌面操作的 Codex 中，把下面这段发给它：

> 请从 https://github.com/SiyiHuang/wechat-chat-archive 安装 archive-wechat-chat 技能。阅读 README，运行本地安装器和 doctor，不覆盖我的其他配置。缺少依赖时给我具体操作步骤；首次使用由 Sol 或 Astra 完整核查，成功后日常由 Sol 编排 Luna。先安装，不要抓取任何聊天。

也可从 [Releases](https://github.com/SiyiHuang/wechat-chat-archive/releases) 下载 ZIP，解压后告诉 Codex：“请阅读这个文件夹的 README 并安装”。无需 GitHub 账号或 API 密钥来使用包中的本地工具。

技术用户可在源码目录运行（需要 Node.js 20+）：

```sh
node scripts/doctor.mjs
node scripts/install.mjs
```

默认安装到 `~/.agents/skills/archive-wechat-chat`。安装器备份已有同名技能，不修改全局模型或权限配置。安装后若技能未出现，重启 Codex。已有旧版路径的用户可指定目标目录，详见安装器 `--help`。

本地技能位置和发现方式依据 [OpenAI 官方技能文档](https://learn.chatgpt.com/docs/build-skills)。此仓库分发的是可安装的技能文件夹，不是已上架插件；安装不自动提供微信桌面控制权限。

## 开始归档

在 Mac 微信中登录并打开想保存的记录，在 Codex 选择 Sol 或 Astra，然后说：

> 使用 $archive-wechat-chat，把我打开的这段微信聊天保存到文档里的“我的微信档案”。保留图片，说明哪些原图已验证、哪些只能保存微信提供的版本。首次先做一个小范围完整验收，通过后继续；允许按技能说明使用子代理。

之后可说：“继续更新同一个档案，只加入新消息。”技能会先检查上次边界，不全局删除同文消息。新手不必手工写 JSON、运行验证或管理子代理。

输出包括 `IMPORT/` 分轮 Markdown/JSON、参与者表、`assets/` 图片和 `index.html`。双击阅读页即可离线搜索、筛选和查看引用。聊天档案应保存在源码仓库之外；分享本技能不需要分享聊天。

## 环境与能力边界

- macOS、已登录的微信、Node.js 20+。OCR 需要 Apple Command Line Tools；缺少时可按提示运行 `xcode-select --install`。Swift 可用时使用 Swift，工具链不匹配时改用同套工具中的 Clang 调用 Apple Vision。不需要额外 npm 依赖。
- Codex 必须能操作桌面，且获得对应的辅助功能/屏幕权限。技能本身不附带桌面控制服务；没有此能力时只能整理你提供的导出和截图。
- Apple Vision 负责本地 OCR，不调用订阅 OCR API。Apple silicon 上可列出 Vision 提供的计算设备，默认由系统调度；**不能保证 OCR 一定使用 Neural Engine**。详见 [Apple OCR](skills/archive-wechat-chat/references/apple-ocr.md)。
- 保存图片使用微信查看器的保存功能。**微信能导出文件不等于发送者原图已恢复**；没有明确原图下载或发送端证据时标为原图未验证。截图只作证据/预览。详见 [图片规则](skills/archive-wechat-chat/references/media-capture.md)。
- OCR 和生成的阅读页本地运行，但交给 Codex 核对的文本及截图仍可能经过当前模型服务处理。“本地 OCR”不代表整个归档过程完全离线。
- 首次由 Sol/Astra 核验，后续 Sol + Luna 分工是工作规则，不能强制切换主模型。模型与子代理不可用时有串行回退；具体账户可用性以客户端为准。

## 验证与开发

```sh
npm test
npm run check-release
node skills/archive-wechat-chat/scripts/archive.mjs --help
```

[数据格式](skills/archive-wechat-chat/references/archive-schema.md)描述 capture JSON、媒体证据、增量规则及旧 Markdown 接入。[首次验收](skills/archive-wechat-chat/references/first-run.md)区分工具测试和真实聊天验收；[模型分工](skills/archive-wechat-chat/references/model-routing.md)给出具体任务边界。`examples/synthetic/` 仅放人工合成样本，不能当真实微信采集结果。`examples/codex-agents/` 为可选配置，不会自动安装。

发布测试范围与未验证项见 [VALIDATION.md](VALIDATION.md)。本工具不保证微信仍能获取已经失效的图片或所有版本的 UI 兼容性。

MIT License。欢迎提交不包含私人聊天、截图或密钥的 bug 报告。
