# Apple Vision 本地 OCR

归档脚本提供 Apple Vision 的新文档识别与原有文字 OCR 两种后端，默认自动选择。图片只交给本机系统框架处理，不调用远程 OCR API，也不下载第三方 OCR 模型。模型服务看到的截图/文字仍遵循宿主的数据处理方式，本地 OCR 不表示整条归档流程完全离线。

## 后端选择与兼容

本包接入 macOS 26 的 `RecognizeDocumentsRequest`，并保留原 `VNRecognizeTextRequest`。启动器检查实际系统与 SDK 版本，再编译、运行相应后端；不按系统版本名称假定编译器可用。

| 接口 | 最低 macOS | 用途 | 本包状态 |
|---|---|---|---|
| `RecognizeDocumentsRequest` | 26；开发 SDK 26+ | 文字行、段落、表格行列、列表 | 自动模式优先，Swift async 实现 |
| `VNRecognizeTextRequest` | 10.15 | 文字、置信度和行坐标 | 兼容后端；原 Swift/Objective-C 两条路径保留 |

微信归档仍需文字坐标与截图共同核对作者、引用及消息边界。文档 API 的段落或阅读顺序不等于聊天消息顺序，也不能独立证明作者。表格截图可利用文档行列辅助整理，结构同样需要回看原图。

```sh
bash "$SKILL_DIR/scripts/ocr.sh" "截图1.png" "截图2.png"
bash "$SKILL_DIR/scripts/ocr.sh" --mode document "文档.png"
bash "$SKILL_DIR/scripts/ocr.sh" --mode text "旧版兼容.png"
```

- `auto`（默认）：系统、SDK、编译或新后端执行不可用时，回退原文字 OCR。输出的 `selection.fallbackReasons` 说明原因，不把回退结果称作结构化文档。
- `document`：要求新 API 真正成功；失败直接报错，不回退。用于首次验收新接口。
- `text`：强制原有路径，无需为此升级至 macOS 26。原入口也保留在 `ocr_legacy.sh`，不带新参数时使用方式与旧版一致。

独立分享时不带编译好的机器专用文件，也不自动安装 SDK 或修改全局工具链。其他用户有基础 Command Line Tools 即可尝试兼容路径；若两个后端都不可用，报告具体错误，不能声称 OCR 已完成。

## 实际引擎与修订版

两个后端显式选择本机支持的最高请求修订版。`engine` 给出 `api`、`implementation`、`kind`（`document`/`text`）、`revision`、`supportedRevisions` 和 `recognitionLanguages`。新 API 的修订版是如 `revision1` 的字符串；原后端保持数字修订版及 `recognitionLevel:"accurate"`。新文档请求没有相同的识别等级选项，不伪造 accurate 字段。

`selection` 包含 `requested`、`selected` 和 `fallbackReasons`。所有结果保留 `images[].path/width/height/lines`。文档后端额外输出 `images[].documents`：

- `transcript`、文档置信度，以及 `paragraphs` 中的文字与归一化区域（`{x,y}` 顶点数组）；
- `tables[].rows` 中的单元格文字、`rowRange` 与 `columnRange`（首尾均含）；合并单元格按 Apple 返回的范围保留；
- `lists` 中的条目文字与原列表标记。

文字 fallback 没有 `documents`，调用者应检查实际 `engine.kind`。输入是图片；PDF 应先由已有本地工具渲染成图片，不假称脚本直接支持多页 PDF。

每行结果包含识别文字、Vision 返回的 0 到 1 置信度，以及归一化边界框。边界框的原点位于图片左下角，`x`、`y`、`width`、`height` 均相对于图片尺寸。

两个后端均让 Vision 自动选择计算设备。原文字结果还会列出该请求公开的设备能力；“设备受支持”只表示能力可用，不能证明本次识别实际使用了该设备，也不能保证 Apple silicon 一定使用 Neural Engine。

若新接口所需 Swift 与 SDK 不匹配，自动模式会转入原文字 OCR；原文字路径自身也保留 Objective-C 后备程序，两种文字实现的 JSON 相同。新结构化输出不能由旧版模拟。

同一批截图一次传入，避免每张重新编译。临时二进制用完即删除；新后端编译限时 45 秒，各后端默认运行预算为 60 秒加每张 30 秒。大图或慢机器可用 `--timeout-seconds 600` 设置每个后端的运行预算；自动回退可能再使用一份预算。超时或 launcher 收到 SIGINT/SIGTERM 时会终止后端的整个进程组并清理临时目录；用户取消不会触发另一个后端。强制 SIGKILL 无法执行清理。不要通过硬编码第三方 API key 或关闭工具权限来处理失败。

参考 Apple 文档：

- [VNRecognizeTextRequest](https://developer.apple.com/documentation/vision/vnrecognizetextrequest)
- [VNRequest.supportedRevisions](https://developer.apple.com/documentation/vision/vnrequest/supportedrevisions)
- [RecognizeTextRequest](https://developer.apple.com/documentation/vision/recognizetextrequest)
- [RecognizeDocumentsRequest](https://developer.apple.com/documentation/vision/recognizedocumentsrequest)
- [WWDC25: Read documents using the Vision framework](https://developer.apple.com/videos/play/wwdc2025/272/)
- [VNRequest.supportedComputeStageDevices](https://developer.apple.com/documentation/vision/vnrequest/supportedcomputestagedevices)
- [VNRequest.setComputeDevice(_:for:)](https://developer.apple.com/documentation/vision/vnrequest/setcomputedevice%28_%3Afor%3A%29)
- [MLComputeDevice](https://developer.apple.com/documentation/coreml/mlcomputedevice)
