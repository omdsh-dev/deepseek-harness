# Agent Note: Version-pinned accessibility core migration

Status: implemented

English | [中文](2026-09-07-rc1-accessibility-core-migration.zh.md)

## Problem

The released accessibility candidate and its automated evidence describe DSH `0.1.2-rc.1`. The official `0.1.5-rc.2` line changes the right sidebar, menu placement, Assistant stream events, persisted fixture generations, and dependency packaging. Reusing old evidence would claim coverage for different code; copying the old layout would discard current product behavior.

## Decision

The migration starts at official tag `dsh-v0.1.5-rc.2`. Current upstream owns Session and layout state. Component owners retain native semantics, keyboard composites, focus containment and restoration, quiet live announcements, and bounded headless text or JSON output.

The new right sidebar owns expansion; the outer frame only reports its geometry. Its named splitter resizes with Arrow keys, selects its width limits with Home and End, and restores the default width with Enter. Explicit expand/collapse actions transfer focus between the same Session's controls without stealing a newer focus owner. A hidden right pane is inert. The left splitter remains keyboard-restorable while collapsed. Narrow frames remove width transitions so newly focused rail controls cannot scroll a clipped intermediate column.

The model menu waits for portal placement before moving focus. File actions retain separate disclosure and preview controls; previews now open the current right sidebar, not the former native file-open path. Accessibility fixtures use the current recorded `session.v3.jsonl` without modifying older generations.

## Alternatives considered

**Change package version strings only.** Rejected because compilation cannot prove portal focus, keyboard navigation, hidden controls, or the assembled preview route.

**Restore the old Details panel.** Rejected because it would replace upstream ownership and remove current sidebar behavior.

**Move required semantics into the companion plugin.** Rejected because post-render diagnostics cannot reliably reconstruct component-owned focus and durable Session boundaries.

**Reuse the earlier candidate's browser record.** Rejected because evidence identifies exact product revisions, not a reusable compatibility label.

## Consequences

The fork and companion must pass their own checks and a clean, exact-revision, three-engine assembled run before publication. The earlier candidate and its evidence remain historical artifacts. The versioned browser-evidence decision remains active; this migration changes its product baseline, not its protocol or the distinction between emulated and real assistive technology.

Unit, browser, geometry, contrast, motion, and headless checks do not establish VoiceOver, NVDA, braille, switch input, real zoom, or independent disabled-developer completion. Human evidence remains open. New sidebar viewers and the separate Desktop surface require their own task evidence; the legacy P0 suite is not a claim of exhaustive accessibility.
