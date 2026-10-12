# 模型分工

本页为 Codex 分工；Claude Code 使用 [对应适配](claude-code.md)。所有宿主都由当前主聊天担任 orchestrator。这里的 Astra/Sol 指主聊天实际选择的模型，不是额外启动的同名编排子代理。不要为“换主模型”创建代理层；用户选择主模型后直接委派工作子任务。

这是任务分配建议，不是后台自动切换模型的服务。用户在 Codex 模型选择器中选主模型；仅在当前宿主提供子代理工具且模型可用时按以下分工启动子代理。不可用就由当前模型串行完成并说明回退，不阻塞归档，也不假称已使用指定模型。

| 阶段 | 主模型 | 可委派任务 | 验收 |
|---|---|---|---|
| 首次部署和真实短范围验证 | Sol high 或 Astra medium | Luna high 只读核对、工具自测 | 主模型逐项检查，明确真实/合成证据 |
| 已验证环境的增量归档 | Sol medium | Luna low/medium：明确字段整理、既有别名查找；Luna high：引用候选、重叠边界核对 | Sol 决定有歧义的作者、日期、去重和原图状态 |
| UI 改版、缺页、复杂引用或冲突 | Sol high，必要时 Astra | Luna 返回候选与证据，不作猜测性合并 | 主模型修复并复验受影响步骤 |

单一主代理负责操作微信，避免两个 agent 抢同一窗口。给子代理发送最小必要的已捕获页面批次、已有边界与 schema；不要传全量聊天历史。任务返回结构化候选、证据位置和不确定项，最终写入只有一个负责人。有序合并、散列、校验和 HTML 构建交给本地脚本，可降低重复推理成本。

[源码仓库的可选 agent 配置](https://github.com/SiyiHuang/wechat-chat-archive/tree/main/examples/codex-agents)提供自定义 agent 文件，用户不必安装。若复制配置，只添加需要的文件，不覆盖现有全局配置。配置语法和模型可用性随 Codex 版本而异。

官方依据（2026-10-11 查阅）：[Codex 子代理与模型配置](https://learn.chatgpt.com/docs/agent-configuration/subagents)、[模型目录](https://developers.openai.com/api/docs/models)。Astra 用于复杂任务、Sol 平衡能力与成本、Luna 用于边界明确的重复任务；具体订阅、限额与可用模型以用户客户端为准。
