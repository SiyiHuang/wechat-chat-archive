# Apple Vision 本地 OCR

归档脚本用 Apple Vision 的 `VNRecognizeTextRequest` 识别截图中的简体中文和英文。图片只交给本机系统框架处理，不调用远程 OCR API，也不下载模型。文字识别 API 最低支持 macOS 10.15；按阶段查询计算设备能力的 API 从 macOS 14 开始可用。

每行结果包含识别文字、Vision 返回的 0 到 1 置信度，以及归一化边界框。边界框的原点位于图片左下角，`x`、`y`、`width`、`height` 均相对于图片尺寸。

运行结果会列出 Vision 为识别请求公开的各阶段设备能力。脚本把设备选择留给 Vision 自动处理；“设备受支持”只表示能力可用，不能证明某次识别实际使用了该设备，也不能保证 Apple silicon 一定使用 Neural Engine。

若 Swift 编译器与 macOS SDK 版本不匹配，启动脚本会改用同样调用本机 Vision 的 Objective-C 小程序。两种路径输出相同 JSON。

一次传入同批截图的所有路径，启动器只编译一次；临时二进制用完即删除，不在技能目录留下机器专用文件。首次编译可能较慢，Swift 探测设置了超时；后备路径仍完全使用 Apple 系统框架。

参考 Apple 文档：

- [VNRecognizeTextRequest](https://developer.apple.com/documentation/vision/vnrecognizetextrequest)
- [VNRequest.supportedComputeStageDevices](https://developer.apple.com/documentation/vision/vnrequest/supportedcomputestagedevices)
- [VNRequest.setComputeDevice(_:for:)](https://developer.apple.com/documentation/vision/vnrequest/setcomputedevice%28_%3Afor%3A%29)
- [MLComputeDevice](https://developer.apple.com/documentation/coreml/mlcomputedevice)
