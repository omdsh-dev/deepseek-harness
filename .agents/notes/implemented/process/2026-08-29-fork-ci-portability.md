# Agent Note: Fork CI portability

Status: implemented

English | [中文](2026-08-29-fork-ci-portability.zh.md)

## Problem

Pull-request workflows selected larger Linux and Windows runners registered only in the upstream organization. A fork inherited those labels but not the runners, Cloudflare credentials, Project-writing GitHub App, or the repository identity embedded in Issue policy. Required jobs therefore remained queued indefinitely and organization-specific jobs failed before they could evaluate a change.

## Decision

Repository ownership is the infrastructure boundary. Pull requests in `deepseek-harness` retain the dedicated larger runners and organization integrations. Pull requests in other owners use standard GitHub-hosted Ubuntu 24.04 and Windows 2025 runners. The snapshot-consumer lane explicitly uses the project reference zone, `Asia/Shanghai`, so persisted browser fixtures do not inherit a runner image's local zone. The Cloudflare preview and Project-mutating Issue lifecycle job are explicitly skipped outside the upstream owner because their credentials and destinations are upstream state. Read-only Issue policy derives its repository coordinates from `GITHUB_REPOSITORY`, falling back to the checked-in upstream configuration for local execution.

## Alternatives considered

**Duplicate every upstream runner and secret in each fork.** Rejected because it couples source review to private infrastructure, creates unnecessary credential distribution, and still leaves a new fork unable to validate its first change.

**Disable pull-request CI in forks.** Rejected because a maintained fork needs reproducible code evidence. Only deployment and organization Project mutation are unavailable; build, test, packaging, policy, Linux, and Windows evidence remain applicable.

## Verification

The four changed workflows parse as YAML, the Issue policy module passes syntax validation, and all 23 Issue-management unit tests pass under Node 22. The bilingual Agent Note pairing is recorded and verified. The first fork run proved standard-runner dispatch, neutral upstream-only checks, and current-repository policy lookup; it also exposed the dedicated pool's implicit time-zone dependency when a standard UTC runner replayed persisted fixtures. The explicit reference zone makes the rerun the integration check for snapshot determinism and the existing aggregate verdict.

## Consequences

Fork validation may take longer on standard runners and does not produce an upstream Cloudflare preview or mutate the upstream Project. Those absences are explicit skipped checks rather than false failures or permanent queues. The upstream path, runner failover variables, deployment behavior, and Project automation remain unchanged.
