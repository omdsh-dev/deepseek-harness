# Agent Note: RC.1 accessibility core migration

Status: implemented

English | [中文](2026-09-07-rc1-accessibility-core-migration.zh.md)

## Problem

The accessibility candidate and its automated browser evidence were built on `dsh-v0.1.2-alpha.2`. DSH `0.1.2-rc.1` changes Session traversal, view selection, browser fixtures, generated snapshots, CI, and removes an obsolete SQLite package. Reusing the alpha.2 evidence would therefore claim coverage for code that was not tested, while a text-only merge would either discard current RC behavior or silently weaken focus and keyboard contracts.

## Decision

The accessibility core is migrated from the exact official `dsh-v0.1.2-rc.1` tag by interaction owner. RC.1 remains authoritative for the Session event model, active-view resolution, current labels, browser fixture behavior, and deleted packages. The accessibility branch retains native semantics, focus containment and restoration, keyboard composite patterns, live announcements, stable headless text and JSON output, environmental accessibility checks, and versioned browser evidence.

The migration regenerates browser expectations from the assembled RC.1 application. Focused tests cover headless output, Session projection, CI evidence contracts, and the affected client owners. A clean committed candidate runs the P0 accessibility suite in Chromium, Firefox, and WebKit; the evidence record identifies the exact commit and treats unsupported forced-colors emulation as a capability limitation instead of a pass.

The Node 24.3 development watcher continues to use `unrun` for complete workspace config graphs. The RC.1 build uses the normal tsdown path. An empty directory left after resolving the removed SQLite package must not remain, because the workspace glob would otherwise treat it as a package and apply the root entry pattern to it.

## Alternatives considered

**Retain alpha.2 as the accessibility release.** Rejected because it omits the current RC product changes and makes compatibility claims against a stale package line.

**Copy the alpha.2 snapshots and tests without rebuilding RC.1.** Rejected because generated expectations are evidence of the assembled product shape, not portable source assets.

**Move the required semantics into the companion plugin.** Rejected because a plugin cannot reliably reconstruct component-owned focus, state, nested dialog, virtualized navigation, and durable Session boundaries after render.

## Consequences

The fork now has an RC.1-based accessibility candidate whose automated P0 browser evidence can be reproduced from a clean exact revision. The companion repository may advertise RC.1 compatibility only after it pins that revision and its own checks pass. Automated browser, DOM, geometry, contrast, motion, and headless evidence still does not prove VoiceOver, NVDA, braille, switch input, or disabled-developer task completion; those evidence rows stay open until real participants submit them.
