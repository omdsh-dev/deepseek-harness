# Agent Note: Web screen-reader and keyboard accessibility ownership

Status: implemented

English | [中文](2026-08-26-web-screen-reader-keyboard-accessibility.zh.md)

## Problem

The Web client exposed ARIA roles for several controls without completing the interaction contracts those roles promise. Session trees had no keyboard entry or roving navigation, modal dialogs did not contain or restore focus, search dismissal could strand focus on an invisible input, layout resize handles were pointer-only, the page lacked stable landmarks, and the conversation had neither a named log nor a bounded completion announcement. A third-party plugin could observe and rewrite the rendered DOM, but hashed classes, component remounts, nested dialogs, and private state made that approach unable to preserve ownership or timing.

## Decision

Accessibility behavior lives with the core component that owns each interaction. The Settings trigger keeps its localized name in the accessibility tree when the collapsed rail hides its visible label. `Modal` maintains a stack of open dialogs, makes the application root inert, selects initial focus, contains Tab traversal, gives Escape and mask dismissal to the topmost dialog, and restores the opening control. The Settings panel and original-image lightbox use that primitive rather than maintaining separate dialog implementations.

Workspace, flat-session, and search-result trees share one roving-focus keyboard controller. One tree item and its owned actions participate in Tab order; Arrow Up/Down and Home/End move through rendered rows, Arrow Right/Left operate Workspace disclosure and parent movement, and Enter/Space activate the focused row. The visually collapsed search input is removed from the accessibility tree. Expanding search reveals and focuses it; Escape and explicit clearing hide it again and return focus to the persistent search button, while outside-pointer dismissal does not override the reader's new target.

The shared `Menu` primitive and the model selector implement the menu-button pattern rather than exposing a collection of independent Tab stops. Arrow Up/Down opens at the relevant edge, Arrow keys, Home/End, and typeahead move within a pane, Right/Left enter and leave submenus, Escape closes one level or the menu, and closing restores the invoking control. Command suggestion inputs expose a named combobox with an owned listbox and active descendant. JSON inspection and subagent lineage are true roving-focus trees: leaf rows participate in the same composite, Right/Left traverse hierarchy, and the lineage trigger can be activated without hover.

User-question choices use named radio groups with one roving radio, Arrow keys and Home/End change the current answer, and custom-answer text fields include the question in their accessible names. Feedback notes retain modal-style focus ownership at both Tab boundaries while pointer dismissal leaves newly chosen focus alone. The Trajectory timeline is a multi-select listbox with active-descendant browsing, Shift range extension, select-all, clearing, and record activation; its ledger table keeps one row in the sequential Tab order and supports Arrow and boundary-key navigation.

The shell renders the conversation column as `main`, the Sidebar and Details panels as named complementary landmarks, and both layout separators as named, focusable vertical separators with value metadata and Left/Right plus Home/End keyboard resizing. The composer always has a localized accessible name. The conversation exposes a named `log` whose streaming mutations are not live, labels user and Assistant articles, and mounts one polite status announcement when a running turn becomes idle; it does not vocalize every token or tool delta.

Session-view and Trajectory-inspector tabs use one roving Tab stop with Arrow Left/Right and Home/End activation, named tab lists, and explicit tab-panel relationships. The Trajectory details separator exposes range metadata, visible keyboard focus, small and Shift-modified steps, and limit keys. The context meter is a disclosure controlling a named information region, not a focus-taking dialog.

Optional companion plugins use declared slots for guidance, diagnostics, preferences, or other additive UI. They do not repair core semantics through DOM mutation. This follows the [slot composition decision](../architecture/2026-07-22-slot-type-chain-implementation.md): replacement-level behavior stays with the component that owns the slot, while additive features register into declared child slots.

## Assistive-technology contract

VoiceOver, NVDA, and JAWS users enter a session tree with Tab and navigate its composite rows with ordinary Arrow keys. Dialogs present one modal focus scope and return to their invoker. Conversation streaming stays readable through structural navigation without producing token-by-token speech; the completion status is the bounded signal that new Assistant output is ready for review. Pointer resizing and keyboard resizing update the same clamped layout preferences.

## Alternatives considered

**A plugin-only MutationObserver adapter.** Rejected because it would infer ownership from unstable DOM, race React commits, duplicate component state, and be unable to implement nested focus restoration or authoritative disclosure changes safely.

**Make every tree row an independent Tab stop.** Rejected because long session lists would dominate sequential navigation and contradict the composite `tree` role. Roving focus preserves one Tab stop while retaining row-owned action buttons for the active item.

**Use `aria-live="polite"` on the streaming message log.** Rejected because token and tool updates would continuously interrupt speech. The log remains structurally named with live updates disabled, and a separate status reports only the running-to-idle transition.

**Keep the Settings dialog separate from `Modal`.** Rejected because two modal implementations would drift on nesting, background inertness, Tab containment, and return focus. The shared primitive carries the contract once.

## Testing

Component tests pin dialog stacking, focus containment, background inertness, return focus (including the image lightbox), menu and typeahead traversal, combobox ownership, tree roving keys and disclosure, radio-group navigation, feedback boundary traversal, timeline range selection, ledger row navigation, collapsed-search accessibility-tree exclusion and search return focus, landmarks, separator metadata and resizing, roving tab lists and tab-panel relationships, disclosure regions, composer names, message-log labels, article labels, and the completion transition. The accessibility workflow runs the GUI suite on Linux, macOS, and Windows, then typechecks, lints, builds the official distribution, and replays the assembled browser suite on a sandbox-capable Linux runner. The assembled browser replay remains the product-level check for semantic output and real browser focus behavior; manual VoiceOver regression covers the native accessibility tree and key routing that jsdom does not implement. The optional `dsh-accessibility` companion audits 14 structural contracts and provides operating guidance; a passing audit is a regression signal, not assistive-technology certification.

## Consequences

Core components carry more explicit focus and keyboard state, and shared primitives must account for nested ownership rather than treating each instance independently. In return, accessibility semantics follow the same lifecycle and state authority as the visual interaction, work without an optional package, and remain testable without selectors tied to presentation. Additive accessibility plugins stay useful for guidance and diagnostics, but they cannot claim to make an unpatched core fully accessible.
