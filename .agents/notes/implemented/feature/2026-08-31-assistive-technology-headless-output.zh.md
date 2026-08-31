# Agent Note: 面向辅助技术的稳定 headless 输出

Status: implemented

[English](2026-08-31-assistive-technology-headless-output.md) | 中文

## Problem

产品的一次性命令会把提供方的每个推理增量流式写入 stderr。读屏软件可能因此在整个任务期间播报 token 粒度的片段，而模型文本中的回车、终端转义序列、BEL 或其他控制字符可能触发重绘或非预期终端反馈。该命令还只暴露没有版本号的最终文本投影，因此无障碍符合性自动化无法在持久化轮次边界之后检查稳定的进程结果。

[删除独立 CLI demo 的决策](../simplification/2026-08-08-remove-cli-demo.zh.md)曾拒绝把其 JSON 与 stream-JSON flag 搬到 headless，因为当时没有产品消费方需要它们。辅助技术使用与版本化无障碍验证已经成为当前产品消费方，但两者都不需要恢复第二个应用或 Session 事件流。

## Decision

`dsh --profile headless` 通过既有应用命令行提供方拥有两个输出 flag。`--accessibility` 选择一种没有颜色、spinner、光标移动、持续更新计数器或推理增量的文本展示。它向 stderr 写入 `dsh: task started`，再恰好写入一个持久化终态行。最终 assistant 文本仍在移除终端转义序列、C0/C1 控制字符、回车重绘与 BEL 后写入 stdout；换行与制表符保留。错误诊断使用同一清理器并折叠为一行。默认文本模式保留既有推理流与最终文本行为。

`--output-format json` 在所属 Session 区间 flush 后，向 stdout 恰好写入一个以换行结束的 `dsh-headless-result` 对象，且不向 stderr 写入结果诊断。`1.0.0` 版本包含 `type`、`schemaVersion`、`status`、`text` 与 `reason`。只有持久化完成的轮次将 `status` 设为 `completed`，其余均为 `failed`。`reason` 投影 completed、结构化 error、aborted 原因种类、blocked、max-tokens、interrupted 与缺少轮次的结果；merge-extensible 原因变成 `{ "kind": "other", "name": <durable-kind> }`。runner 直接失败时得到一个 `INTERNAL` error 结果。JSON 模式独立于 `--accessibility` 抑制推理；两个 flag 同时出现时，JSON 仍是唯一输出展示。

该模式建立进程输出属性，而不是辅助技术兼容性证据。针对具名读屏软件、终端、操作系统、语音配置与残障用户工作流的证据，仍须作为独立制品记录。

## Alternatives considered

**把低噪声输出设为默认值。**不采用，因为现有终端用户与诊断会刻意消费流式推理；在没有显式 flag 时改变 stdout 或 stderr 会破坏产品命令的当前行为。

**保留推理并添加定期无障碍摘要。**不采用，因为 token 片段仍会占满读屏队列，也可能在日志中暴露敏感推理。一个开始行与一个持久化终态行具有数量上界，并对应权威状态。

**恢复原 CLI demo 或把每个 Session 事件流式输出为 JSON。**不采用，因为这会重新创建第二个应用，或让公开协议超出当前消费方所需。无障碍自动化只需要一个最终结果，持久机器控制已由 SDK 与 ACP 负责。

**把经过清理的输出当作读屏支持证明。**不采用，因为自动化字节无法观察语音顺序、焦点、终端设置、用户理解或独立完成任务。

## Consequences

无障碍模式会刻意改变包含终端控制字节的模型文本；需要精确原始字节的用户使用默认文本或 JSON。JSON 字符串通过 JSON 转义保留内容，不会在输出行上变成终端控制。脚本可以解析一种格式而不必拼接 stdout 与 stderr；未来不兼容的结果变更需要新的 schema 版本。

产品获得了一个可供无障碍符合性检查使用的无密钥、版本化 CLI 输出目标，但具名测试者记录之前，真实 NVDA、JAWS、Narrator、VoiceOver 与 Orca 证据仍然缺失。出于显式兼容选择，默认命令继续承担推理输出的隐私与冗长成本。

## Testing

包级测试固定默认兼容性、推理抑制、控制字符清理、有界状态行、每种内建非完成结果、直接失败、单行 JSON、schema 版本、命令解析、帮助与无效格式。构建后的 `dsh` 验收通过发布入口，以 mock 提供方启动随附 headless profile，并验证默认、无障碍与 JSON 展示。
