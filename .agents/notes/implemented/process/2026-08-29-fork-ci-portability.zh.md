# Agent Note: fork CI 可移植性

Status: implemented

[English](2026-08-29-fork-ci-portability.md) | 中文

## Problem

Pull Request workflow 选择了只注册在上游组织中的 Linux 与 Windows larger runner。fork 会继承这些标签，却不会继承对应 runner、Cloudflare 凭据、写入 Project 的 GitHub App，或 Issue policy 中写死的仓库身份。因此，必需任务会无限排队，组织专属任务也会在评估变更前失败。

## Decision

以仓库 owner 作为基础设施边界。`deepseek-harness` 下的 Pull Request 继续使用专用 larger runner 与组织集成；其他 owner 下的 Pull Request 使用 GitHub 标准托管的 Ubuntu 24.04 与 Windows 2025 runner。snapshot-consumer 通道显式使用项目参考时区 `Asia/Shanghai`，避免持久化浏览器 fixture 继承 runner 镜像的本地时区。Cloudflare 预览与会写入 Project 的 Issue lifecycle 任务依赖上游凭据和目标，因此在非上游 owner 中明确跳过。只读 Issue policy 从 `GITHUB_REPOSITORY` 获取当前仓库坐标，本地执行时则回退到仓库中记录的上游配置。

runner 选择与工作负载规模共同构成可移植性契约。标准 4 核 Linux 和 Windows fork runner 均使用 2 个 coverage worker、2 个 coverage partition 与串行 coverage gate；Linux consumer 通道还使用 2 个浏览器 snapshot worker、2 个并发 snapshot 场景，并限制 lint、发布检查与 consumer gate 的并发。上游 16 核路径保留原有较大预算。基于真实进程的测试仍验证同一行为，覆盖率仍为 100%；减少的只是争抢 CPU 的无关工作。对时序敏感的断言只接受已有文档定义的等价就绪状态，或在异步投递本身属于受测行为时获得显式等待预算。

## Alternatives considered

**在每个 fork 中复制全部上游 runner 与 secret。** 拒绝，因为这会让源码评审依赖私有基础设施，扩大不必要的凭据分发，而且新 fork 的首次变更仍无法自行验证。

**在 fork 中禁用 Pull Request CI。** 拒绝，因为持续维护的 fork 需要可复现的代码证据。只有部署与组织 Project 写入不可用；构建、测试、打包、策略、Linux 与 Windows 证据仍然适用。

## Verification

变更后的 workflow 均可解析为 YAML，Issue policy 模块通过语法校验，23 个 Issue-management 单元测试全部在 Node 22 下通过。workflow 合约、PowerShell 持久会话、Inspector 事件投递与 Oxlint 重试套件合计 48 项测试通过，另有 3 项按平台跳过。双语 Agent Note 配对已经记录并验证。最初几轮 fork 运行已经证明标准 runner 分发、上游专属检查中性跳过与当前仓库策略查询有效；同时也暴露了专用 runner 隐含的时区和 16 核并发假设：UTC 会改变持久化 fixture，而 6 个浏览器 worker、32 个 snapshot 场景及相互重叠的 coverage 通道会让标准 runner 上的真实进程与浏览器时序缺少 CPU。限制 Linux 负载后，其 100% 覆盖率通道已经通过，标准镜像中可用的 `pwsh` 还执行了两个在无 PowerShell 环境中会跳过的场景，并暴露出陈旧 fixture。两个 fixture 均通过真实 PowerShell 7.6.5 执行完成刷新，包含当前权限上下文与工具 schema，并迁移为 canonical packed-session 布局，随后又通过独立 replay 复核。同一次完整运行还表明，Windows coverage 在标准 4 核主机上仍沿用上游的 6 worker、4 partition、3 gate 配置；其失败是进程 hook 超时与异步写入延迟，而非覆盖率缺口。将按 owner 限制的 coverage 预算应用于 Windows 后，大范围资源饥饿已被消除，并进一步隔离出两个可移植性缺陷：projection-cache 测试假定真实异步存储会在固定 40 毫秒内完成，而 journal-mode 重试截止时间在无关数据库初始化之前就开始计时。测试现改为等待可观测的存储状态，每次 journal transition 也会在该边界获得完整配置重试预算；102 项定向测试与 lint 全部通过，其中包含模拟 journal 之前初始化已耗时 150 毫秒的回归场景。

下一轮 Linux coverage 已将失败范围收敛为两个边界缺陷，而不是大范围资源饥饿。SQL ownership gate 拒绝了一个把变量 SQL 字符串继续传给父类的回归测试 override；现在改为在数据库构造函数中推进模拟的 journal 前耗时，不再创建无归属查询源。更重要的是，真实 PowerShell 场景证明：当 host 与 PSReadLine 仍在协商终端协议时写入 setup，启动结果可能返回默认 `PS …>` 提示符，也可能只反复重绘 setup 源码而不执行。PowerShell 启动因此被明确拆成两个阶段：DSH 先等待原生提示符并排空自动生成的终端响应，然后才通过“必须出现受控提示符”的 send 提交 UTF-8 与受控提示符 bootstrap。第二阶段禁用静默和通用 stdin-wait 回退，只有同时观察到 DSH 私有 OSC 提示符标记与前台 shell 证据才会完成。SQLite、SQL 边界、终端启动与就绪套件合计 158 项测试全部通过；持久化 PowerShell 状态与 secret 清理场景在真实 PowerShell 7.6.5 上连续 10 次通过，完整真实 PowerShell 测试组中的状态与 UTF-8 两个场景也全部通过。新一轮矩阵仍将作为跨平台 coverage 执行与既有聚合结论的集成检查。

## Consequences

fork 验证在标准 runner 上可能耗时更长，也不会生成上游 Cloudflare 预览或写入上游 Project。这些缺失会表现为明确的跳过检查，而不是误报失败或永久排队。降低 fork 并发以更长运行时间换取确定性证据，不会删除场景或放宽覆盖率。上游路径、runner 故障切换变量、部署行为与 Project 自动化均保持不变。
