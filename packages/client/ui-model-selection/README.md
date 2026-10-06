---
description: "Model selection for the Web GUI: the /model popup and the composer model seat over one per-session provider-grouped directory; for users and maintainers of model routing."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-model-selection

English | [中文](README.zh.md)

Desktop product events use the optional [product analytics service](../product-analytics/README.md); ordinary Web interactions are excluded.

## Summary

The Web GUI lets users switch the model and reasoning effort for an existing session through either the `/model` popup or the composer's model control. Both surfaces present the same provider-grouped choices, and the selected model determines the available effort names and default. A complete selection applies to the next request; a running step keeps the model and effort it started with. If the selected model is unavailable, the composer stays disabled until the user selects an available model or that exact model becomes available again.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

DeepSeek account and API-key routes appear as separate provider groups, each exposing the same configured model catalog.

The unselected model label uses the same regular weight as an available model name and retains the saved reasoning effort caption for existing and new sessions; effort editing requires an available model. Clicking the unselected trigger opens the model list directly; Escape closes it.

Mount this plugin alongside `ui-conversation` and the commands package. The composer shows a model control, and `/model` opens the same directory as a popup. The model menu exposes checked choices and supports Arrow keys, Home, and End. Tab or Shift+Tab closes it without selecting a value and follows native focus order. Escape returns from a drilled pane to its parent, then closes the root menu and restores the trigger. A drilled model pane with search focuses its combobox, which controls a grouped listbox; otherwise it focuses the current choice; returning focuses its parent control. The Host supplies the current model and effort.

The composer shows the catalog name while the selected model is available, and its saved `provider/model` ID when the model or provider is removed, including account sign-out. The stored provider, model, and reasoning effort remain unchanged.

Mouse selection uses native browser clicks, including their cancellation behavior; a press alone never selects. Opening the menu focuses its current choice; clicking the trigger again closes it and returns focus there. While a selection from either entry is pending, focus stays on the trigger, the trigger shows a spinner in place of its chevron, and each row whose value the selection carries shows one in place of its check. A rejected selection leaves the menu open; Arrow keys navigate its rows, and Tab exits without selecting.

### Model and effort

The button's model menu shows search only when its full catalog contains more than four models; smaller catalogs focus the current model or first row and support keyboard navigation directly. The `/model` command always keeps its search field. Both search fields match model names case-insensitively, including nonconsecutive characters in order; leading and trailing spaces are ignored. Within each provider, prefix matches come first, followed by alignment score and then catalog order. Empty groups are hidden. Empty catalogs and queries without matches are announced through a status region. Search keeps focus while arrow keys cycle the highlighted result across provider groups; Enter selects it in the composer menu; Tab or Shift+Tab leaves without selecting. Left and right arrows keep their native caret behavior. Opening highlights the current model or the first available row, and editing the query resets the highlight to the first result. Reopening the model pane clears the query.

Model and reasoning-effort names use weight 400 (regular) in the composer menu, including the selected item. The search field follows the command popup's compact treatment with transparent background and border in both palettes, with no leading icon and a caption-tone placeholder. The clear button appears for a nonempty query and restores the full list with focus in the search field.

Both entries group models by provider, with DeepSeek Account first and DeepSeek second; third-party providers retain their catalog order. Both use the shared, asynchronously observed sticky headings from [ui-primitives](../ui-primitives/README.md#understand-the-implementation): transparent at rest, with the theme's 94%-opaque fill only while pinned, and `md` corners outside macOS Desktop. The composer menu shows model and effort names only. Navigation chevrons use `--dsw-alias-menu-icon`. The `/model` popup shows provider names as group headings and model names as rows, without repeating the provider on each row or showing catalog descriptions. Its search placeholder, no-match text, and empty-catalog text use the same localized labels as the composer model menu. The popup applies the selected model's default effort; the composer can then choose any advertised effort. An adapter without reasoning metadata leaves the Effort row absent; there is no arbitrary effort input.

The composer replaces the model and effort text with the Models icon when the expanded controls cannot share one line, and restores the text when space permits. The full selection remains available in the trigger's accessible name, tooltip, and menu.

### Unroutable sessions

Catalog availability does not block sending with a saved selection; request execution reports missing credentials or unavailable models. Refreshes and refresh failures retain the last displayed selection and groups. A Host reset clears that display. Sign-out hides the account provider from the picker while preserving the saved provider/model ID and reasoning effort. Signing in restores the catalog name when that model is available again. Existing session logs remain unchanged.

### Selection failures

When another writer owns the Session, model-selection failures tell the user to quit other running DSH instances and retry.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

Menus use the shared `MenuSurface` material, including the macOS backing for background blur; custom content follows the [menu rules](../../../docs/web-styling.md#component-rules).

<details>
<summary>Implementation internals — click to expand</summary>

The composer `ModelSelect` and `/model` option builder share [provider ordering](src/client/provider-order.ts), while both searches use `rankByName` within each provider. The command supplies optional groups and `searchMode: 'fuzzy-label'` through the [popupSelect API](../ui-commands/README.md#use-this-package); both entries use `MenuGroup` and rebuild its sticky observer when the rendered groups change. The command popup fills the composer overlay, while the button retains its compact menu.

Two entries over ONE per-session directory owned by `ModelDirectoryResolver` (`ctx.modelDirectories`): the `/model` popupSelect contribution (registered through `ctx.commandUi`) and the composer's named `conversation.input.model` seat both load the session's available directory through `session.models` and submit through `session.selectModel` via the same `ModelDirectory` instance, so a switch made in either entry is what the other shows next. Directory loads and selections share a generation counter so an older response never overwrites a newer one. The directory publishes the latest submitted selection as `pending` until it settles or a connection reset invalidates it; a connection reset drops every resident projection and repulls the Host-restored selection before display. Directories are per-session, resolved lazily, and disposed with the session scope; addressed subagent sessions expose neither entry. Every resident directory refetches directly on forwarded `llm/adapters-updated`, `settings/document-updated`, and credential update events.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the model surface is not enough. They move from the browser surfaces to the command popup shell and the selection contract.

- [ui-commands](../ui-commands/README.md) — the popupSelect shell the `/model` contribution registers into.
- [ui-conversation](../ui-conversation/README.md) — declares the composer's `conversation.input.model` seat.
- [dsh-agent-default-model](../../core/agent-default-model/README.md) — the default-model service for sessions that never choose.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `session.selectModel` selection both entries submit: the Host snapshots the complete `ModelSelection` at the next prompt-assembly boundary and owns the model-visible effect, while a running step keeps its assembled selection.

#### KV Cache effect

Switching the route can reduce or invalidate provider-side cache reuse for subsequent requests; the prompt prefix itself is untouched.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the current model surface. They are current package constraints, not a general model-router comparison or a task backlog.

- **No create-time or addressed-subagent selection** — both entries require an existing ordinary session's Agent; there is no draft-phase model choice to fold into session creation, and subagent continuation deliberately exposes no independent model-selection contract.
- **Directory names are presentation-only** — selection and persistence use provider/model/effort ids; a provider whose catalog or exact-model metadata lookup fails lists as an unselectable failure row until reload.
- **No arbitrary effort input** — the composer offers only the exact model's adapter-advertised levels; an adapter without reasoning metadata leaves the Effort row absent.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The plugin registers a single command contribution, and the HMR-safety spec proves that the registration is disposed correctly. The plugin emits no Cordis events and owns no cross-plugin mutable state.
