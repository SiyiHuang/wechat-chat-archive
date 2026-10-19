# Apple Vision 本地 OCR

归档脚本用 Apple Vision 的 `VNRecognizeTextRequest` 识别截图中的简体中文和英文。图片只交给本机系统框架处理，不调用远程 OCR API，也不下载第三方 OCR 模型。文字识别 API 最低支持 macOS 10.15；按阶段查询计算设备能力的 API 从 macOS 14 开始可用。

## 是否为最新文档识别方案

截至 2026-10-19 核对 Apple 官方文档，当前实现是逐行文字 OCR，不是较新的结构化文档识别。不要把它写成“已使用最新文档理解 API”。

| 接口 | 最低 macOS | 用途 | 本包状态 |
|---|---|---|---|
| `VNRecognizeTextRequest` | 10.15 | 文字、置信度和行坐标 | 当前已实现；Swift/Objective-C 两条路径 |
| `RecognizeTextRequest` | 15 | Swift 原生 async 文字识别接口 | 尚未迁移；接口新不单独证明识别准确率提高 |
| `RecognizeDocumentsRequest` | 26 | 文档结构，包括段落、表格、列表等 | 尚未接入或验收，不输出结构化文档结果 |

微信归档需要文字坐标与来源截图共同核对作者、引用及消息边界。文档结构识别不能自动证明聊天发言人的归属，因此当前继续使用已验证的文字 OCR。若要解析微信分享的表格或扫描文档，较新的文档接口值得单独适配和验收，不能以普通 OCR 结果冒充表格/段落结构。

本次检查的开发工具仅有 macOS 15.2 SDK，Swift 与 SDK 仍存在编译兼容性问题；系统版本够新也不代表已安装可构建 macOS 26 文档 API 的工具链。不为执行本技能自动升级整套开发工具。

## 实际引擎与修订版

每次请求显式选择 `VNRecognizeTextRequest.supportedRevisions` 中本机运行时提供的最高修订版，保持 `accurate` 模式。这表示该接口在当前系统支持的最高版本，不代表整套 Vision 最新 API 或最佳准确率。输出 JSON 新增 `engine`：`api`、`implementation`（`swift`/`objective-c`）、`kind:"text"`、`revision`、`supportedRevisions`、`recognitionLanguages` 和 `recognitionLevel`。既有 `images` 与 `compute` 保留。升级系统后可以直接检查实际选择，不根据操作系统名称猜测版本。

每行结果包含识别文字、Vision 返回的 0 到 1 置信度，以及归一化边界框。边界框的原点位于图片左下角，`x`、`y`、`width`、`height` 均相对于图片尺寸。

运行结果会列出 Vision 为识别请求公开的各阶段设备能力。脚本把设备选择留给 Vision 自动处理；“设备受支持”只表示能力可用，不能证明某次识别实际使用了该设备，也不能保证 Apple silicon 一定使用 Neural Engine。

若 Swift 编译器与 macOS SDK 版本不匹配，启动脚本会改用同样调用本机 Vision 的 Objective-C 小程序。两种路径输出相同 JSON。

一次传入同批截图的所有路径，启动器只编译一次；临时二进制用完即删除，不在技能目录留下机器专用文件。首次编译可能较慢，Swift 探测设置了超时；后备路径仍完全使用 Apple 系统框架。

参考 Apple 文档：

- [VNRecognizeTextRequest](https://developer.apple.com/documentation/vision/vnrecognizetextrequest)
- [VNRequest.supportedRevisions](https://developer.apple.com/documentation/vision/vnrequest/supportedrevisions)
- [RecognizeTextRequest](https://developer.apple.com/documentation/vision/recognizetextrequest)
- [RecognizeDocumentsRequest](https://developer.apple.com/documentation/vision/recognizedocumentsrequest)
- [WWDC25: Read documents using the Vision framework](https://developer.apple.com/videos/play/wwdc2025/272/)
- [VNRequest.supportedComputeStageDevices](https://developer.apple.com/documentation/vision/vnrequest/supportedcomputestagedevices)
- [VNRequest.setComputeDevice(_:for:)](https://developer.apple.com/documentation/vision/vnrequest/setcomputedevice%28_%3Afor%3A%29)
- [MLComputeDevice](https://developer.apple.com/documentation/coreml/mlcomputedevice)
