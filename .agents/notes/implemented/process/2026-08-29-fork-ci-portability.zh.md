# Agent Note: fork CI 可移植性

Status: implemented

[English](2026-08-29-fork-ci-portability.md) | 中文

## Problem

Pull Request workflow 选择了只注册在上游组织中的 Linux 与 Windows larger runner。fork 会继承这些标签，却不会继承对应 runner、Cloudflare 凭据、写入 Project 的 GitHub App，或 Issue policy 中写死的仓库身份。因此，必需任务会无限排队，组织专属任务也会在评估变更前失败。

## Decision

以仓库 owner 作为基础设施边界。`deepseek-harness` 下的 Pull Request 继续使用专用 larger runner 与组织集成；其他 owner 下的 Pull Request 使用 GitHub 标准托管的 Ubuntu 24.04 与 Windows 2025 runner。Cloudflare 预览与会写入 Project 的 Issue lifecycle 任务依赖上游凭据和目标，因此在非上游 owner 中明确跳过。只读 Issue policy 从 `GITHUB_REPOSITORY` 获取当前仓库坐标，本地执行时则回退到仓库中记录的上游配置。

## Alternatives considered

**在每个 fork 中复制全部上游 runner 与 secret。** 拒绝，因为这会让源码评审依赖私有基础设施，扩大不必要的凭据分发，而且新 fork 的首次变更仍无法自行验证。

**在 fork 中禁用 Pull Request CI。** 拒绝，因为持续维护的 fork 需要可复现的代码证据。只有部署与组织 Project 写入不可用；构建、测试、打包、策略、Linux 与 Windows 证据仍然适用。

## Verification

四个变更的 workflow 均可解析为 YAML，Issue policy 模块通过语法校验，23 个 Issue-management 单元测试全部在 Node 22 下通过。双语 Agent Note 配对已经记录并验证。fork Pull Request 将作为标准 runner 分发、上游专属检查中性跳过、当前仓库策略查询与既有聚合结论的集成检查。

## Consequences

fork 验证在标准 runner 上可能耗时更长，也不会生成上游 Cloudflare 预览或写入上游 Project。这些缺失会表现为明确的跳过检查，而不是误报失败或永久排队。上游路径、runner 故障切换变量、部署行为与 Project 自动化均保持不变。
