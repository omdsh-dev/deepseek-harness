# Agent Note: Web accessibility interaction ownership

Status: implemented

English | [中文](2026-08-29-web-accessibility-interaction-ownership.zh.md)

## Problem

Several shared Web controls exposed accessibility roles without implementing the keyboard and focus behavior those roles promise. Modal dialogs did not contain or restore focus, menus exposed menu items as ordinary independent controls, Workspace and Session trees had no composite keyboard model, collapsed search retained an accessibility-tree input without an explicit focus-return contract, layout separators were pointer-only, the application lacked stable named landmarks, a closed mounted Details subtree remained keyboard-reachable, and the context meter described a non-modal disclosure as a dialog. A companion plugin can diagnose rendered markup, but it cannot safely reconstruct component state, focus ownership, or nested dismissal timing after rendering.

## Decision

The core component that owns an interaction also owns its accessibility behavior. Optional accessibility plugins provide diagnostics, guidance, preferences, and authoring assistance through declared slots; they do not rewrite core interaction semantics through DOM observation. This division follows the [slot composition decision](../architecture/2026-07-22-slot-type-chain-implementation.md): replacement behavior stays with the component that owns the slot, while additive behavior registers through declared child slots.

The shared `Modal` primitive maintains a stack of open dialogs, makes `#root` inert while that stack is non-empty, chooses initial focus, contains forward and reverse Tab traversal, and gives Escape and mask dismissal only to the topmost dialog. On close it prefers an optional explicit durable focus-restoration target and falls back to a connected opening control when that target is absent or disconnected. A dialog with no tabbable descendant retains focus on its dialog container. A visible heading can name headless content through `aria-labelledby`; the ordinary variant retains its localized close control.

The shared `Menu` primitive implements the menu-button relationship for an inline anchor and accepts an explicit name and return-focus reference for an externally rendered anchor. Arrow Up or Down opens at the corresponding edge; Arrow keys, Home, End, and typeahead move among enabled items in the current menu; Right and Left enter and leave submenus; Escape closes one level or the root menu; Tab exits in its requested direction instead of visiting every menu item. Selection and root dismissal return focus unless the selected action has deliberately moved it elsewhere.

The application shell renders the conversation column as `main` with one localized level-one application heading. Session navigation and open Session details are named complementary landmarks. Closed Details content remains mounted for state continuity but is inert and absent from the accessibility tree. Both visible resize handles are named, focusable vertical separators with range and current-value metadata; Left and Right resize according to the panel's physical edge, Home selects the minimum width, End selects the maximum width, and Shift applies a larger step. Shell overlays and separators remain inside the main landmark.

The Workspace browser owns one roving Tab entry for each non-empty grouped, flat, or search-result tree. Up and Down, Home and End move among rendered rows; Enter and Space activate the focused row. Authored `aria-level` metadata lets Right open or enter a Workspace and Left close it or return from a Session without inferring hierarchy from presentation wrappers. Buttons owned by only the active row join sequential navigation. Empty containers expose no tree role. A collapsed search input is absent from the accessibility tree; Escape and Clear restore focus to the persistent search button, while an outside pointer dismissal preserves the user's new focus target.

Workspace and Session row menus synchronously return focus to their connected row action before opening a rename or deletion dialog. That handoff gives the shared `Modal` a durable invoker instead of the portaled menu item that is about to unmount. Rename dialogs initially focus and select their name input; Workspace deletion initially focuses its non-destructive Close action. Failure alerts leave the editable retry target focused, and dismissal or successful rename restores the row action while it remains connected. Successful Workspace deletion intentionally has no return target because the owning row is removed.

The in-app directory browser reports listing and creation failures as live alerts within the dialog that owns the failed action, not as sibling error dialogs. An unreadable path retains the path editor and prior listing for correction; an initial listing failure preserves path entry as the recovery route. A failed nested folder creation retains the name field and its focus for retry; dismissing that child restores the connected **New folder** invoker while the parent dialog remains open and covered correctly.

The outer Workspace picker treats an adoption failure as a described dialog: the visible alert is programmatically associated with the dialog, the non-destructive Cancel action receives initial focus, and dismissal returns to the durable **Add workspace** trigger through the Modal's explicit restoration target. **Choose again** opens a fresh directory flow. If the trigger is absent or becomes disconnected, the shared fallback avoids focusing stale DOM while preserving the connected opening control when one remains.

The composer model seat implements its two-level selector as a single-entry menu button. Edge opening, roving Arrow/Home/End movement, Right entry, Left or Escape return, selected-value initial focus, and trigger restoration remain inside the component that owns the selection panes. The command `popupSelect` owns a search combobox that controls its named listbox; DOM focus remains in that search field while `aria-activedescendant` and `aria-selected` expose the controller's one current filtered option. Its overlay binds the controller's focus-return callback to the exact composer card that owns the open popup, rather than looking up an arbitrary resident input. Loading, applying, empty, and failure states remain discoverable without adding every result to sequential Tab navigation.

The context meter implements a disclosure relationship. Its trigger exposes expanded state and controls a stable panel id; the open panel is a named information region rather than a modal dialog. Escape, an outside pointer action, or activating the trigger again closes it without moving focus into the panel.

The Conversation shell owns the Session View tab pattern across its separate header and body slots. Only the active Chat or Trajectory tab is sequentially tabbable; Left and Right wrap, Home and End move to an edge, and movement activates the focused View. Stable per-Session ids connect every tab to the active `tabpanel`, whose label points back to the selected tab.

The Trajectory record inspector owns the same automatic-activation tab contract for the details available to the selected record. One active tab remains in sequential navigation; Left and Right wrap, Home and End move to an edge, and every destination becomes both selected and focused. The stable panel is controlled by every tab and labelled by the current tab.

The Trajectory ledger owns one roving row entry across its loaded logical records. Up and Down move one record, Home and End move to the loaded edges, and an off-screen virtual destination is scrolled into the mounted window before receiving focus. Enter and Space activate a record or collapsed summary. Nested Request controls join sequential navigation only for the active row; request-only separators retain their explicit control.

The Trajectory timeline owns a multiselect listbox over its record spans. DOM focus stays on the overview while `aria-activedescendant` exposes the browsed record. Arrow keys browse, Shift extends an inclusive record range, Home and End reach an edge, Enter or Space opens the active record, Control or Command plus A selects the loaded domain, and Escape clears the range. Keyboard-active records remain mounted and visually indicated across a zoomed viewport.

The generic user-question composer owns a named roving radio group for each single-choice question. Arrow keys wrap, Home and End reach an edge, and movement selects without changing the current page; explicit activation retains immediate advancement. A question-index change caused by activation, pager navigation, skipping, or validation recovery focuses the new page's selected radio, first checkbox, or named custom field. Recommendation and option-description copy is connected through `aria-describedby` without changing the model-authored option name.

## Alternatives considered

**Repair the rendered application from a companion plugin.** Rejected because a MutationObserver would infer ownership from unstable markup, race React commits, duplicate private state, and remain unable to guarantee nested focus restoration or authoritative disclosure changes.

**Give every menu item an ordinary Tab stop.** Rejected because a long menu would dominate sequential navigation and contradict the composite `menu` interaction pattern. Roving focus preserves one sequential entry while arrow keys operate the collection.

**Give every Workspace and Session row an ordinary Tab stop.** Rejected because long histories would dominate sequential navigation and split one tree into unrelated stops. A roving row keeps one entry while arrow keys expose the ordered hierarchy; actions remain reachable from the active row.

**Unmount Details whenever it closes.** Rejected because the shell intentionally preserves the subtree and its state. Applying `inert` and `aria-hidden` removes closed controls from navigation without changing that lifecycle.

**Keep the context meter as a dialog.** Rejected because it neither takes focus nor blocks the application. A disclosure controlling a named region matches its interaction and avoids announcing modal behavior that does not exist.

## Verification

Seventy focused jsdom tests exercise modal stacking, initial and contained focus, background inertness, disconnected openers, empty dialogs, menu-button ownership including a Tooltip-wrapped trigger, edge opening, roving keys, typeahead, submenus, Tab exit, named landmarks, closed-Details exclusion, separator metadata and resizing, and context disclosure ownership. The complete GUI lane passes 288 files and 3,830 tests, with one test skipped by its existing condition.

Four focused Workspace-row, Workspace-browser, assembled Session-rename, and in-app directory-browser files pass 160 tests. They additionally pin menu-to-dialog invoker handoff, safe initial focus, editable focus retention across failure alerts, correction and retry paths, nested-dialog focus return, and return to connected Workspace or Session row actions; the three responsibility sources retain 100% statement, branch, function, and line coverage. The built application then passes the same seeded tree hierarchy, roving focus, disclosure keys, search focus return, model-menu keyboard path, command-combobox ownership and focus return, narrow reflow, focus visibility, Settings containment, forced-colors, and reduced-motion checks in Chromium (six tests), Firefox (five tests with the Chromium-only forced-colors case skipped), and WebKit (five tests with that case skipped).

The shared-primitives and Workspace-picker focused files pass 55 jsdom tests, including forwarded button refs, explicit-versus-fallback Modal restoration, adoption-error description, safe Cancel initial focus, retry, and return to a connected picker trigger. The assembled `workspace-management` replay passes all 13 tests; its adoption-failure case removes a task-owned directory after the browser has rendered it, exercises the real Host canonicalization refusal over the wire, verifies the dialog and focus contract, and confirms that the durable Workspace registry is unchanged. No focused source-coverage claim is made for this slice because `WorkspacePicker` is explicitly excluded by the unit-coverage configuration.

Twenty-three focused model-seat and command-popup tests pass, including edge opening, single-entry menu focus, pane entry and return, current-option focus, combobox ownership, active-descendant synchronization, exact-composer binding, selection, cancellation, error, and focus-restoration paths.

Twenty-two focused Conversation-shell tests pass, including the named roving View tab list, Arrow/Home/End activation and wrap, stable tab-to-panel relationships, and the active panel's sequential focus entry.

Thirty-seven focused Trajectory-table tests pass, including the ledger's single-entry row stop, logical Arrow/Home/End movement across a virtual scroll boundary, active-row Request action ownership, and the detail inspector's single-entry tab stop, activation, focus movement, and active tab-to-panel relationship. Thirty-three assembled Trajectory view tests include multiselect listbox ownership, active-descendant browsing, Shift range extension, record opening, whole-domain selection, and the integrated ledger path; together, 70 focused tests pass.

Seventeen focused user-question composer tests pass, including the named single-entry radio group, wrapped Arrow/Home selection without page advance, recommendation and description relationships, focus continuity into the next custom field, IME-safe input, validation recovery, cancellation, failure re-arming, and Session-scoped draft restoration.

A production build followed by the assembled Web replay passes 92 of 93 files, with one conditionally skipped file; 312 tests pass and 15 are skipped. Reviewed accessibility-tree goldens add the application `main`, its level-one heading, named Session-navigation complementary landmark, keyboard separator, and named menu while removing controls from the already-collapsed Details subtree. Contract type checking, contract lint, and the Node 22 documentation lane also pass. These checks verify DOM, focus, built-composition, and browser accessibility-tree contracts; they do not certify spoken output or real assistive-technology operation.

## Deferred

This decision does not claim complete Web accessibility. Timeline listbox and range spoken output, model-selection and command-popup spoken output, question-form announcements and plan-review consumer evidence, conversation log and completion announcements, tool disclosures, contrast and forced-colors behavior, zoom and reflow, reduced-motion behavior, browser coverage, and task-level VoiceOver, NVDA, JAWS, Narrator, and Orca evidence remain separately verified work.

## Consequences

Shared primitives, the Workspace browser, and the shell carry explicit keyboard, focus, naming, hierarchy, and hidden-content state, including nested ownership that is more complex than pointer-only behavior. In return, the accessibility contract follows the same lifecycle and state authority as the visible interaction, works without an optional package, and can be regression-tested without selectors tied to presentation. Automated component checks remain necessary evidence but are insufficient for a complete accessibility claim.
