# Claude Code

本技能在主聊天运行，不设置 `context: fork`，不要求创建另一个 orchestrator。技能文件与 Codex 共用；本地 Apple Vision OCR 和归档 CLI 不依赖任何模型 API。

## 安装与调用

从分享仓库根目录运行：

```sh
node scripts/install.mjs --client claude
node scripts/doctor.mjs --json
```

技能安装到 `~/.claude/skills/archive-wechat-chat`。基础安装不预设工作代理模型。先询问用户：“编排保持当前主 Agent 的模型。本轮思考/复核和执行/转录分别使用哪些模型？也可以让当前主 Agent 串行完成。”提供的模型选项只来自当前客户端实际可用列表；不把 Sonnet 或 Haiku 当默认，也不擅自切换主模型。

若用户选择使用工作代理，再执行下列命令，把占位符替换成用户确认的模型。支持 `inherit`（当前主模型）、Claude 别名或完整模型 ID；模型语法有效不代表当前账户一定可用。

```text
node scripts/install.mjs --client claude --with-agents --thinking-model <用户选择的思考模型> --execution-model <用户选择的执行模型>
```

两个只读工作代理安装到 `~/.claude/agents/`：`wechat-reviewer` 用思考模型，`wechat-transcriber` 用执行模型。已有不同内容的同名代理会阻止安装，先比较再决定如何保留，不覆盖其他配置。更换已安装代理模型时，先展示当前配置与用户选择的差异，按用户已确认的选择只修改对应 `model` 字段；重新运行安装器不会强行覆盖。

项目内安装可加 `--dest /你的项目/.claude/skills/archive-wechat-chat`；带 `--with-agents` 时代理放入同级 `.claude/agents/`。配置变更未被发现时重新打开会话。在 Claude Code 输入：

```text
/archive-wechat-chat 将当前打开的合并转发 Chat History 保存到我指定的本地目录，保留图片。主聊天负责编排，首次先验证小范围，再继续整个固定包。
```

## 主聊天与工作代理

始终由当前主 Agent、当前模型确认窗口模式、范围、滚动边界和图片路径，并负责全局编排与最终验收。首次和日常均遵守这条规则，不另选 Sonnet 编排，也不创建替代主聊天的“编排子代理”。思考与执行是工作子任务，不是把全局编排交出去。

用户选择的思考模型用于引用歧义、边界和候选复核；执行模型用于已捕获小批次的结构化转录。若用户明确选主聊天串行，不创建工作代理。当前会话已有明确选择时沿用并简短复述，不反复询问；否则等待用户选择后才启动模型工作子任务，期间可完成本地 doctor 等独立检查。若所选模型不可用，询问替代选择，不静默改成更贵或更弱的模型。不要使用 Codex 的 Sol/Astra/Luna 标识或推理档位。

主模型由用户在客户端选择，技能和安装器都不修改。只向工作代理提供本批次证据和必要 schema，不传全量历史；只有主聊天操作共享微信窗口和最终写入。

## 桌面工具适配

在本地 Claude Code 会话中先检查实际工具。Claude Code Desktop 提供 computer use 功能，需按客户端提示启用并授权微信；系统可能还要求辅助功能和屏幕录制权限。不要把能运行 `claude` 或 doctor 通过当成已获桌面能力。终端会话是否提供 desktop/MCP 能力以当前工具清单为准，不假定一定有或一定没有。

- 有桌面工具：遵循该工具文档观察、滚动、打开图片及原生保存。`cua_repl` 是另一宿主的示例，不是 Claude Code 必有的 API；不要调用不存在的方法。
- 有 AX：提取正文，仍以画面核对作者和引用。只有截图时，将截图按工具支持方式保存到本地证据目录，再用随包 `scripts/ocr.sh` 批量处理；OCR 候选需逐项回看。没有 AX 本身不阻止截图/OCR 路线，但完整性需要同样的逐条证据。
- 桌面工具只能返回会话图片、不能落盘时，说明限制，使用工具实际支持的导出方式；不要伪造本地截图路径或改用付费 OCR。无法提供本地 OCR 输入时保留待补材料，不声称本地 OCR 已执行。
- 没有桌面控制时，仍可处理用户提供的截图/AX 导出和图片；明确这是材料整理模式。让用户在支持 computer use 的本地客户端启用功能后再验收自动抓取，不额外搭建付费 API 服务。

不要假定 Chrome 浏览器控制能操作原生微信，也不要自动安装来历不明的桌面 MCP。模型看到的截图/文字可能由 Claude 服务处理；只有 OCR、文件校验和阅读页生成是本地处理。

## 首次验收

按 [first-run.md](first-run.md) 验收所选窗口模式。记录宿主是 Claude Code、实际版本/模型/UI 工具和是否有 AX；Codex 的既有真实样本验证不能替代 Claude Code 首次验收。引用匹配、媒体、重复导入和 CLI 检查与 Codex 完全相同。

官方依据（2026-10-11 核对）：[技能路径与调用](https://code.claude.com/docs/en/skills)、[子代理配置](https://code.claude.com/docs/en/sub-agents)、[主模型配置](https://code.claude.com/docs/en/model-config)、[Desktop computer use](https://code.claude.com/docs/en/desktop#let-claude-use-your-computer)。功能权限与计划要求以这些页面和当前客户端为准。
