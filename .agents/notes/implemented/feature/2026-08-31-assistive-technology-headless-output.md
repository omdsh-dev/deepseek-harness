# Agent Note: Stable headless output for assistive technology

Status: implemented

English | [中文](2026-08-31-assistive-technology-headless-output.zh.md)

## Problem

The product one-shot command streamed every provider reasoning delta to stderr. A screen reader could therefore announce token-sized fragments for the duration of a task, while carriage returns, terminal escape sequences, BEL, or other controls in model text could trigger redraw behavior or unwanted terminal feedback. The command also exposed only an unversioned final-text projection, so accessibility conformance automation had no stable process result to inspect after the durable turn boundary.

The [separate CLI demo removal](../simplification/2026-08-08-remove-cli-demo.md) rejected moving its JSON and stream-JSON flags onto headless because no product consumer required them. Assistive-technology use and versioned accessibility verification are current product consumers, but neither requires restoring a second application or a session-event stream.

## Decision

`dsh --profile headless` owns two output flags through its existing app command-line provider. `--accessibility` selects a text presentation with no color, spinner, cursor movement, updating counter, or reasoning deltas. It writes `dsh: task started` and exactly one durable terminal-state line to stderr. The final assistant text remains on stdout after terminal escape sequences, C0/C1 controls, carriage-return redraws, and BEL are removed; newlines and tabs remain. Error diagnostics use the same sanitizer and collapse to one line. Default text mode retains its existing reasoning stream and final-text behavior.

`--output-format json` writes exactly one newline-terminated `dsh-headless-result` object to stdout after the owned Session interval is flushed and writes no outcome diagnostics to stderr. Version `1.0.0` carries `type`, `schemaVersion`, `status`, `text`, and `reason`. `status` is `completed` only for a durable completed turn and `failed` otherwise. `reason` projects completed, structured error, aborted cause kind, blocked, max-tokens, interrupted, and missing-turn outcomes; merge-extensible reasons become `{ "kind": "other", "name": <durable-kind> }`. A direct runner failure becomes an `INTERNAL` error result. JSON mode suppresses reasoning independently of `--accessibility`; when both flags are present, JSON remains the sole output presentation.

The mode establishes process-output properties, not assistive-technology compatibility evidence. Evidence for a named screen reader, terminal, operating system, speech configuration, and disabled-user workflow remains a separate recorded artifact.

## Alternatives considered

**Make low-noise output the default.** Rejected because existing terminal users and diagnostics deliberately consume streamed reasoning, and changing stdout or stderr without an explicit flag would break the product command's current behavior.

**Keep reasoning and add periodic accessible summaries.** Rejected because token fragments would still dominate a screen reader queue and could expose sensitive reasoning in logs. One start line and one durable terminal line are bounded and correspond to authoritative state.

**Restore the former CLI demo or stream every Session event as JSON.** Rejected because that would recreate a second application or enlarge the public protocol beyond the current consumer. Accessibility automation needs one final result, while SDK and ACP already own persistent machine control.

**Treat sanitized output as proof of screen-reader support.** Rejected because automated bytes cannot observe speech order, focus, terminal settings, user comprehension, or independent task completion.

## Consequences

Accessibility mode intentionally changes model text that contains terminal control bytes; users who need the exact original bytes use default text or JSON. JSON strings retain their content through JSON escaping and never become terminal controls on the output line. Scripts can parse one format without combining stdout and stderr, and incompatible future result changes require a new schema version.

The product now has a keyless, versioned CLI output target for accessibility conformance checks, but real NVDA, JAWS, Narrator, VoiceOver, and Orca evidence remains outstanding until named testers record it. The default command continues to carry the privacy and verbosity cost of reasoning output by explicit compatibility choice.

## Testing

Package tests pin default compatibility, reasoning suppression, control sanitization, bounded status lines, every built-in non-completed outcome, direct failures, single-line JSON, schema version, command parsing, help, and invalid formats. The built `dsh` acceptance starts the shipped headless profile against the mock provider and verifies default, accessibility, and JSON presentations through the published entry.
