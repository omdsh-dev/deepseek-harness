# Agent Note: Versioned core browser accessibility evidence

Status: implemented

English | [中文](2026-08-31-versioned-core-browser-accessibility-evidence.zh.md)

## Problem

The assembled Web accessibility suites exercised real DSH routes, but their terminal exit status did not identify the exact product revision, enumerate the required task checks, distinguish an unsupported engine check from a pass, or preserve the boundary between headless browser assertions and human assistive-technology evidence. The focus-environment test also sampled only the shell and Settings. Extending it across the P0 routes exposed a real narrow-layout regression: after collapsing an expanded sidebar, keyboard focus remained on the renamed Open sidebar toggle while the desktop rail-entry translation painted that control under the main column for one animation interval.

## Decision

The P0 browser lane now covers the named shell and separators, Sessions tree and search, Session views, conversation transcript and disclosure, Trajectory, composer draft editing, menus, Settings, and Full access risk admission. A fresh 320 CSS-pixel page samples focused controls across those routes for viewport intersection, `:focus-visible`, and topmost paint; 640 and 320 CSS-pixel runs retain the 200% and 400% equivalent reflow checks. Reduced-motion runs and Chromium forced-color emulation remain separate required checks.

On viewports no wider than 600px, or whenever reduced motion is requested, sidebar collapse settles the 56px rail in a layout effect and suppresses the desktop rail-entry animation. The focused toggle therefore occupies the visible rail before paint. Wider motion-enabled layouts keep the existing crossfade and translation.

`pnpm run test:web:accessibility` remains the dirty-worktree-friendly diagnostic command. A clean committed candidate uses `pnpm run test:web:accessibility:evidence`, which rebuilds and runs all three engines before emitting `.artifacts/accessibility/core-browser-evidence.json`. The report uses `dsh-non-at-browser/1.0.0-draft`, identifies the core consumer as `dsh-core-browser-non-at`, pins the root package version and full 40-character Git revision, records host and engine versions, maps nine cataloged P0 task IDs to stable check IDs, and carries fixed limitations. The runner rejects a dirty worktree, invalid revision, failed Vitest process, missing or duplicate required title, a required skip, or a forced-color check reported as passed by an unsupported engine. A subset record is `partial`; only Chromium, Firefox, and WebKit together are `pass`.

Pull-request CI replaces the former diagnostic invocation inside the existing required `node-24-accessibility` job with the versioned evidence command. It uploads the exact-revision JSON for seven days after success. This adds neither another job nor another browser run; it makes the already-required lane produce a reviewable record.

## Alternatives considered

**Treat the existing console summary as evidence.** Rejected because a copied `14 passed` line has no enforceable product identity, task inventory, engine capability boundary, or evidence limitations.

**Call every zero-failure browser subset a pass.** Rejected because it would allow a Chromium-only run to stand in for the cross-engine contract and would turn unsupported forced colors into an implied pass.

**Wait one animation interval before sampling narrow focus.** Rejected because the focused control is obscured during that interval for a real keyboard user. The product removes the inaccessible frame instead of teaching the test to ignore it.

**Represent the automated record as screen-reader or WCAG conformance evidence.** Rejected because browser semantics and geometry do not observe spoken or braille output, real zoom, Windows High Contrast, or independent disabled-user task completion.

## Consequences

Each clean candidate can now produce a reviewable, schema-addressed record whose exact checks and limitations are stable across runs. Renaming or removing a required assertion deliberately breaks the evidence runner until the protocol mapping is reviewed. The stronger focus route guards the narrow-sidebar defect across all three engines, and unit tests retain both narrow-viewport and reduced-motion settle behavior. Evidence generation costs one build plus three serial assembled-browser runs and writes only to the ignored `.artifacts/` directory; required pull-request CI retains that small record without duplicating the job or build. Passing this gate improves automated product evidence but does not close the real VoiceOver, NVDA, Windows High Contrast, zoom, low-vision, or disabled-developer evidence rows.
