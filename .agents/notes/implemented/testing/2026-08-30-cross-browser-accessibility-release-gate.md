# Agent Note: Cross-browser accessibility release gate

Status: implemented

English | [中文](2026-08-30-cross-browser-accessibility-release-gate.zh.md)

## Problem

The Web application had semantic unit coverage and Chromium browser snapshots, but no required release gate exercised accessibility behavior across browser engines or access modes. A change could preserve the wide Chromium snapshot while making Settings unreachable from the keyboard in WebKit, clipping focus at a narrow viewport, overflowing one Settings panel, ignoring reduced motion, or losing usable system colors.

This gap also blurred evidence claims. Browser automation can detect repeatable conformance regressions, but it cannot prove that a screen-reader user can complete a real DSH task, that an assistive-technology and operating-system combination works end to end, or that a disabled participant considers the workflow independent, effective, and safe.

## Decision

Add a focused assembled-application accessibility suite and run it serially in Playwright Chromium, Firefox, and WebKit. The suite starts the shipped Web scaffold, uses deterministic session replay, and verifies the following release-critical behavior:

- named application landmarks and core controls;
- 200% and 400% reflow equivalents at 640 and 320 CSS pixels without document or Settings-panel horizontal overflow;
- a complete keyboard path into Settings, visible and unobscured focus, modal containment, Escape dismissal, and focus restoration;
- every registered Settings section at the narrow viewport, not only the initially selected section;
- Windows forced-colors behavior in Chromium; and
- reduced-motion preference without removing core information or controls.

The suite uses the keyboard convention exposed to a real user by each platform. macOS WebKit uses Option+Tab when the host's full keyboard navigation preference is disabled; other tested combinations use Tab. This preserves a keyboard-only assertion without mutating host preferences or adding redundant `tabindex` values to native controls.

The PR workflow installs the browser versions owned by the Web package and runs this suite in a separate required `node-24-accessibility` job. The aggregate verdict depends on that job, so a browser-specific or access-mode regression blocks merging. Hosted runners install browser system dependencies; the persistent failover image installs only the browser payloads.

The gate is one layer of the versioned accessibility evidence model. It may support an automated-browser result, but it must not be reported as real assistive-technology or disabled-user evidence. Release and support claims continue to identify the exact DSH version, operating system, browser, assistive technology and version, task script, result, severity, tester role, and evidence date.

## Alternatives considered

**Rely on component tests and accessibility-tree snapshots.** These tests are fast and retain package ownership, but they do not exercise browser focus navigation, viewport geometry, media emulation, or the assembled shell.

**Run the complete Web snapshot corpus in all three engines.** This would multiply a broad consumer lane while producing substantial engine-specific rendering churn. A focused invariant suite gives failures a clear accessibility meaning and keeps the existing snapshot corpus responsible for its recorded-session contracts.

**Use only an automated rules scanner.** Rule scanners catch valuable markup and contrast classes, but they cannot prove keyboard task completion, modal focus behavior, narrow-panel reflow, or focus visibility. They remain complementary rather than sufficient evidence.

**Configure macOS keyboard navigation globally before WebKit tests.** Changing a host preference makes local runs stateful and can affect unrelated applications. Using the documented user keyboard convention keeps the test isolated and represents the disabled-preference path.

## Invariants

- Chromium, Firefox, and WebKit all run the same assembled-app semantic, reflow, focus, and reduced-motion contract.
- An unsupported media emulation is explicitly engine-scoped; it does not silently skip the rest of an engine's accessibility gate.
- The 320 CSS-pixel path visits every registered Settings section and checks every sampled focus target against the viewport and hit-testing surface.
- Keyboard opening, modal containment, Escape dismissal, and focus restoration are tested without pointer fallback.
- The required PR aggregate includes the accessibility browser job.
- Browser automation is labelled separately from real assistive-technology and disabled-user evidence.
- A green gate never authorizes a “fully accessible” claim by itself.

## Consequences

The narrow shell and Settings modal now reflow instead of compressing controls into unusable columns. Settings reuses the shared modal primitive for inert background content, focus trapping, Escape handling, and restoration. Collapsed navigation retains an accessible Settings name across engines, narrow-screen collapse no longer leaves focus behind a transition, and focused Settings controls scroll fully into view.

Contributors receive a focused failure naming the browser and violated geometry or interaction invariant. The extra required job adds one build and three short browser runs to each pull request, while keeping failures independent from the larger snapshot and artifact lane.

## Risks

Playwright WebKit is a recent WebKit build rather than branded Safari, and WebKitGTK on Linux is not equivalent to Apple-platform WebKit. Local macOS evidence and required Linux CI therefore complement one another but do not replace a Safari plus VoiceOver task run.

Geometry and media-emulation checks can still miss speech output, braille presentation, screen-reader interaction modes, cognitive load, time pressure, destructive-action comprehension, and recovery from errors. Versioned manual scripts, real assistive-technology results, and disabled-participant evidence remain required before broader support claims.
