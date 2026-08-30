# Agent Note: Web 浏览器预期输出的必需 CI 门禁

Status: implemented

[English](2026-07-30-web-browser-snapshot-ci-gate.md) | 中文

## 问题

[无密钥 Web 浏览器 e2e 车道](2026-07-24-web-gui-browser-e2e-lane.zh.md)只由本地 `pnpm run test:web` 运行，PR CI 不比较 `snapshots/web/` 或 `apps/web/tests/expected/` 下的 Web 预期输出。因此，改变用户可见 Web 输出的 PR 可以在漏刷预期输出时保持绿色；后来任意分支显式运行 `DSH_SNAPSHOT=refresh`，都会替前序变更补账并产生与本分支无关的 diff。普通本地运行已经默认使用只读 replay，缺口是 PR 级的强制执行，而不是禁止 refresh 写入。

## 决策

Linux PR 的 `node 24 / snapshots and artifacts` 必须运行完整 Web 浏览器 replay/compare。配置 `DSH_WEB_SNAPSHOT_WORKERS` 后，`scripts/run-gates.ts` 把 `test:web:ci` 登记为 `ci-consumers` 门禁，并显式注入 `DSH_SNAPSHOT=replay`；CI 永不以 `record` 或 `refresh` 模式运行，因此提交的预期输出与当前组装应用不一致时测试直接失败，不会在 runner 内静默改写后通过。

消费方 job 在[消费方独立构建](../process/2026-07-30-independent-ci-consumer-build.zh.md)中负责唯一一次 Linux 构建，因此 `apps/web/dist` 和包的 `lib/` 目录会保留在其工作区中，供浏览器套件使用。在托管运行器上，CI 按锁文件中的 Playwright 版本安装 Chromium 及其系统依赖。在持久化故障切换 VM 上，镜像负责预装 Linux 系统软件包，CI 只安装 Chromium，避免每次运行都通过 `apt` 改动系统。PR 恢复以操作系统和锁文件为键的浏览器缓存，使必需路径无需承担压缩和上传开销，并可在锁文件变化时按操作系统前缀回退。没有任何 master 作业生成这些 hosted 缓存，因此恢复只能命中仍有归档的旧条目，直至其被逐出。自托管热备运行相同的比较，但不执行托管缓存操作。

本地 `pnpm run test:web` 仍先构建，再串行运行完整浏览器套件；`test:web:built` 是已有构建产物的串行执行入口。开发者只在确认用户可见输出有意变化后显式运行 `DSH_SNAPSHOT=refresh pnpm run test:web`，评审每一处预期输出 diff，再以 replay 模式复验不再写文件。

CI 的 `scripts/run-web-snapshots.ts` 先用相互独立的 Vitest 调用串行运行 `hmr-live.e2e.ts`、`cordis-tool-round.e2e.ts`、`workflow-run.e2e.ts` 与 `workspace-management.e2e.ts`。HMR 场景会修改已构建工作区状态；其余三个场景则拥有长生命周期、有状态的浏览器／宿主序列：Cordis 批准与 steering（中途引导）、真实 workflow worker 与本地子会话导航，以及在同一 Workspace 管理页面内连续执行的指针、菜单、归档、重载和目录操作。新进程使这些责任方脱离资源竞争的文件池，同时不修改其等待、断言或 golden。四者全部通过后，其余文件进入同一个有界 Vitest 池。远程 authority 场景显式把浏览器主机名映射到 loopback，并让 scaffold 的令牌交换通过 loopback 连接、携带相同的 HTTP Host 头，从而在不依赖操作系统通配 `.localhost` 解析器的情况下继续覆盖 Host 信任语义。所有子进程都继承 stdio，外围门禁再通过 `run-gates` 流式传递输出。

对 PR 而言，门禁仅在 Linux 消费方 job 中运行：这些场景面向 POSIX，其他 PR job 不安装 Chromium。自托管的默认分支 Linux 串行热备也包含该比较，而 macOS 和 Windows 串行 job 仍不使用浏览器（不存在托管的 Linux 串行聚合）。PR 的 `all checks passed` 已依赖消费方 job，因此浏览器比较失败会阻止合并，无需新增 branch-protection check 名称。

完整本地 replay 中，6-worker 浏览器命令耗时约 65–71 秒。12-worker 对比约为 50 秒，因此把浏览器 worker 预算减半只增加约 15–20 秒，而不是让墙钟时间翻倍。门禁调度器会在 `built-package-invariants` 成功后立即启动浏览器快照，并发运行彼此独立的门禁，因此既不需要专用 job 超时，也不需要手动制定 YAML 顺序规则。

## 曾考虑的替代方案

**继续只要求本地运行。** 已否决：执行依赖开发者记忆，正是陈旧 golden 跨 PR 漂移的原因，不能保证产生行为变化的 PR 自己携带预期输出 diff。

**让 CI 以 `refresh` 模式运行后检查工作树。** 已否决：写后比较把断言机制变成生成器，若工作树检查接入有误，就可能把回归变成能够通过的预期输出更新；replay 直接比较已有 golden，失败面更小。

**新建独立 browser job 并重新构建全仓。** 已否决：它会重复依赖安装和发布构建。现有 Linux 消费方 job 已负责该构建，并已被统一的 required verdict 聚合。

**把全部浏览器文件都放进并行池。** 不予采用，因为 HMR 会修改共享的已构建状态，而 Cordis、workflow-run 与 Workspace 管理会跨多步场景保留生命周期状态。有界池仍适合相互独立的文件；四个明确责任方使用新进程，避免池竞争使其有状态序列失效。

**用 jsdom 快照代替真实 Chromium。** 已否决：jsdom 不覆盖浏览器、HTTP/SSE 承载及真实客户端插件包的组合；它仍可用于快速的下层反馈，但不能替代组装后的浏览器链路。

## 后果

每个 PR 都在合并前证明当前 Web 组装与所有已提交的浏览器预期输出一致；漏刷会在改变该组装的同一个 PR 中失败。成本是消费方 job 需要安装 Chromium、串行运行 4 个文件并执行 1 个有界池；消费方独立构建与浏览器缓存避免重复构建和下载。并行文件的失败会立即流式显示，但 worker 预算或责任边界的任何变化仍需要完整端到端证据，而不能依据运行中耗时猜测。门禁不声称跨平台浏览器一致性，Playwright/Chromium 升级若改变 ARIA 格式，升级 PR 必须显式 refresh 并评审 churn。
