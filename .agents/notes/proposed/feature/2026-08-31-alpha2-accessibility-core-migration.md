# Agent Note: Alpha.2 accessibility core migration

Status: proposed

English | [中文](2026-08-31-alpha2-accessibility-core-migration.zh.md)

## Problem

The verified accessibility candidate is bound to the `dsh-v0.1.2-alpha.1` product shape, while `dsh-v0.1.2-alpha.2` changes 1,604 paths from that official tag. The candidate changes 302 paths from its development base, and 128 of those paths overlap the official alpha.2 delta. A direct merge produces conflicts across interaction owners, tests, generated browser expectations, coverage infrastructure, and files removed by alpha.2. Passing alpha.1 evidence therefore cannot be transferred to alpha.2, and mechanically retaining either side would hide regressions or discard current product behavior.

Alpha.2 also retains shared controls that expose accessibility semantics without owning the corresponding interaction. In particular, the shared `Modal` declares a modal dialog but does not make the application inert, contain focus, restore focus, or arbitrate nested dialogs. A companion plugin cannot reconstruct those lifecycle guarantees after React renders the control.

## Proposal

Build the alpha.2 accessibility candidate from the exact `dsh-v0.1.2-alpha.2` tag and migrate behavior by interaction owner. For each alpha.1 candidate responsibility, compare the official alpha.1 base, the verified alpha.1 candidate, and alpha.2; classify it as already equivalent, additive, redesigned, obsolete, test/process-only, or regenerated evidence. Reimplement redesigned responsibilities against alpha.2 contracts instead of cherry-picking the old branch.

Core components continue to own required names, states, keyboard operation, focus, live announcements, contrast behavior, reflow, and reduced-motion behavior. Optional accessibility plugins add diagnostics, preferences, authoring assistance, and evidence collection through declared extension points; they do not repair core semantics with DOM observation.

The migrated owner slices now restore the shared dialog and menu contracts, their Settings and Workspace consumers, the Workspace adoption-error path, and Workspace and Session tree navigation. `Button` exposes its native focus owner; `Modal` manages an open-dialog stack, application-root inertness, initial and contained focus, topmost dismissal, descriptions, and connected focus restoration; Settings consumes that shared owner instead of duplicating modal lifecycle behavior; and the Workspace picker associates its alert, initially focuses Cancel, and restores the durable picker trigger. `Menu` names inline and external-trigger popups, synchronizes their expanded and controlled relationships, enters enabled items, owns wrapped arrow, Home, End, typeahead, submenu, Escape, and Tab operation, and restores the trigger without overriding focus intentionally moved into a follow-on surface. It distinguishes action rows from checkable choices: single-choice and toggle rows expose `menuitemradio` or `menuitemcheckbox` with synchronized `aria-checked`, keyboard traversal owns all three item roles, and the visual check is hidden from the accessible name. The outer dialog respects keys a nested composite already consumed, so a portaled Settings menu can close or release focus without dismissing the dialog or losing its focus boundary. Grouped, flat, and search results use one roving tree entry with arrow, Home, End, disclosure, activation, typeahead, and row-action focus ownership. A built assembled-app contract operates these dialog, menu, and tree paths in Chromium, Firefox, and WebKit. Later slices cover the remaining alpha.2 interaction owners, including shell landmarks and separators, conversation views, structured tool and trajectory navigation, question and review flows, and announcements.

Expected browser output is regenerated from alpha.2 only after the owning behavior passes focused source tests. Evidence records the exact product commit, browser and operating-system capability, assistive technology and version, task, result, limitation, and reviewer. Automated DOM, accessibility-tree, browser, contrast, reflow, motion, and packaging checks remain necessary but never substitute for task-level assistive-technology sessions and disabled-developer evidence.

The public evidence fork remains executable without upstream private infrastructure. Pull requests outside the upstream owner select standard GitHub-hosted Linux and Windows runners with four-core workload budgets; upstream-only Cloudflare deployment and Project mutation are explicit neutral skips, while read-only policy follows the current repository identity. This keeps public verification reproducible without requesting or billing upstream larger runners.

PowerShell evidence counts only when the job resolves a real `pwsh` binary; a skip on a host without PowerShell is a recorded capability limitation, not passing evidence. Startup first observes PowerShell's native startup output with a no-input initialization, then submits the controlled-prompt bootstrap exactly once and waits for backend `stdin_read` plus its owned marker, including when marker output lands between startup operations. It returns only the concise controlled prompt rather than echoed initialization source, preserving useful, non-noisy terminal feedback for assistive technology. A no-input readiness probe may accept the current exact stdin wait. A persistent-shell send that writes input accepts the same controlled foreground's exact wait only after polling observes a leave-and-return transition or post-submission output proves that a fast command crossed the unsampled transition; the pre-write wait alone is never reused. Quiescent `inferred_idle` is limited to operation-owned output when no input was written, the foreground is not inspectable, or a non-shell child owns it; echoed output from the same controlled shell cannot settle a send by silence alone. The following send still proves state persistence and secret scrubbing. The PowerShell-owned session, system-prompt, and tool-schema snapshots are refreshed together from the current alpha.2 profile, normalized into the canonical packed layout, and replayed on a PowerShell-capable host.

## Alternatives considered

**Merge the complete alpha.1 candidate into alpha.2.** Rejected because the histories share only the official alpha.1 release base and the semantic overlap crosses redesigned source, generated expectations, and deleted files. A text merge cannot decide which interaction contract remains valid.

**Ship a companion plugin that rewrites inaccessible DOM.** Rejected because post-render observation cannot authoritatively control component state, nested dismissal, focus restoration, virtualized navigation, or async error recovery. The plugin remains useful for diagnostics and authoring support.

**Keep alpha.1 as the accessibility release until upstream stabilizes.** Rejected because users would lose alpha.2 product and security changes, and stale evidence would accumulate behind the current package line.

## Acceptance criteria

- Every migrated responsibility is reviewed against alpha.2 architecture and has focused unit or component evidence plus a built, assembled browser path when user-visible.
- Keyboard-only, VoiceOver on macOS, NVDA on Windows, and at least one additional platform screen-reader path complete versioned core-task protocols; braille and other input evidence is recorded as contributors become available.
- Disabled developers validate that the supported core tasks can be completed independently, effectively, and safely, with failures and workarounds retained in the public ledger.
- Release metadata identifies the exact DSH compatibility range and evidence status; no tag, package, or documentation claims complete accessibility while required task or assistive-technology evidence is missing.
- Generated snapshots, coverage ownership, and CI workflow changes are derived from alpha.2 and pass without erasing failed run history or rerunning failures into invisibility.
- PowerShell evidence records the resolved runtime version, observes native startup output without input before one bootstrap, returns only the controlled startup prompt even across an operation-boundary race, replays both canonically packed PowerShell header-owner snapshots with real PowerShell, rejects same-shell echo plus silence as readiness, and proves a second send after the controlled shell returns to stdin wait without weakening state-persistence or secret-scrubbing assertions.
- Fork pull-request jobs resolve to standard hosted runners, retain full required scenarios at bounded concurrency, and leave upstream-only integrations neutral rather than queued or falsely failing.

## Risks

Alpha.2 may continue changing while the migration is in progress, so evidence can become version-bound before every task is covered. Broad shared primitives can also change focus order for many consumers; each slice needs both primitive tests and assembled consumer checks. Automated browser semantics may pass while spoken output or real input workflows remain confusing, which is why public evidence must distinguish automated conformance from assistive-technology and disabled-user validation.
