# Agent Note: Fork CI portability

Status: implemented

English | [中文](2026-08-29-fork-ci-portability.zh.md)

## Problem

Pull-request workflows selected larger Linux and Windows runners registered only in the upstream organization. A fork inherited those labels but not the runners, Cloudflare credentials, Project-writing GitHub App, or the repository identity embedded in Issue policy. Required jobs therefore remained queued indefinitely and organization-specific jobs failed before they could evaluate a change.

## Decision

Repository ownership is the infrastructure boundary. Pull requests in `deepseek-harness` retain the dedicated larger runners and organization integrations. Pull requests in other owners use standard GitHub-hosted Ubuntu 24.04 and Windows 2025 runners. The snapshot-consumer lane explicitly uses the project reference zone, `Asia/Shanghai`, so persisted browser fixtures do not inherit a runner image's local zone. The Cloudflare preview and Project-mutating Issue lifecycle job are explicitly skipped outside the upstream owner because their credentials and destinations are upstream state. Read-only Issue policy derives its repository coordinates from `GITHUB_REPOSITORY`, falling back to the checked-in upstream configuration for local execution.

Runner selection and workload sizing form one portability contract. The standard four-core fork runner uses two coverage partitions, serial coverage gates, two browser snapshot workers, two snapshot scenarios, and bounded lint, publication, and consumer-gate concurrency. The upstream 16-core path retains its existing larger budgets. Process-backed tests still exercise the same behavior and coverage remains 100%; only unrelated work competing for CPU is reduced. Timing-sensitive assertions accept documented equivalent readiness states or receive an explicit wait budget where asynchronous delivery is the behavior under test.

## Alternatives considered

**Duplicate every upstream runner and secret in each fork.** Rejected because it couples source review to private infrastructure, creates unnecessary credential distribution, and still leaves a new fork unable to validate its first change.

**Disable pull-request CI in forks.** Rejected because a maintained fork needs reproducible code evidence. Only deployment and organization Project mutation are unavailable; build, test, packaging, policy, Linux, and Windows evidence remain applicable.

## Verification

The changed workflows parse as YAML, the Issue policy module passes syntax validation, and all 23 Issue-management unit tests pass under Node 22. The workflow contract, PowerShell persistence, Inspector event-delivery, and Oxlint retry suites pass together with 48 tests and three platform skips. The bilingual Agent Note pairing is recorded and verified. The first fork runs proved standard-runner dispatch, neutral upstream-only checks, and current-repository policy lookup. They also exposed the dedicated pool's implicit time-zone and 16-core concurrency assumptions: UTC changed persisted fixtures, while six browser workers, 32 snapshot scenarios, and overlapping coverage lanes starved real-process and browser timing on a standard runner. Once load was bounded, the standard image's available `pwsh` also executed two PowerShell scenarios that no-PowerShell environments had skipped and exposed stale fixtures. Both fixtures were refreshed through real PowerShell 7.6.5 execution, including current permission context and tool schemas, then passed an independent replay run. The explicit zone, owner-scoped budgets, and refreshed fixtures make the next run the integration check for snapshot determinism, 100% coverage, and the existing aggregate verdict.

## Consequences

Fork validation may take longer on standard runners and does not produce an upstream Cloudflare preview or mutate the upstream Project. Those absences are explicit skipped checks rather than false failures or permanent queues. Lower fork concurrency trades wall-clock time for deterministic evidence; it does not remove scenarios or relax coverage. The upstream path, runner failover variables, deployment behavior, and Project automation remain unchanged.
