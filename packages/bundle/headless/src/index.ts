/**
 * @deepseek-ai/dsh-headless — one-shot direct Agent driver. The bundle patch
 * rides over dsh-base without Host, HTTP, or browser plugins; this runner
 * creates one Agent through the core registry, drives the task to quiescence,
 * optionally streams provider reasoning to stderr, flushes its Session, prints
 * the durable result to stdout, and exits.
 *
 * @module @deepseek-ai/dsh-headless
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { SessionEvent, SessionId, TurnEndReason } from '@deepseek-ai/dsh-session'
import type { HeadlessOutputFormat } from './startup.ts'
// Empty type imports carry the loader Context merge for the settlement await
// and the cmdline Context merge for the appExit host value.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'headless-runner'

/** Core services required before the one-shot turn can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Stable schema version for one final JSON result. */
export const HEADLESS_RESULT_SCHEMA_VERSION = '1.0.0' as const

/** Stable discriminator for one final JSON result. */
export const HEADLESS_RESULT_TYPE = 'dsh-headless-result' as const

/** Plugin config resolved from this app's injected command-line provider. */
export interface Config {
  /** The prompt text for the single run. */
  task: string
  /** Use stable line-oriented text status and suppress reasoning deltas. */
  accessibility: boolean
  /** Render stdout as final text or one versioned JSON result. */
  outputFormat: HeadlessOutputFormat
}

export const Config: z<Config> = z.object({
  task: z.string().required(),
  accessibility: z.boolean().default(false),
  outputFormat: z.union(['text', 'json'] as const).default('text'),
})

/** Versioned machine-readable projection of the durable turn outcome. */
export type HeadlessResultReason =
  | { kind: 'completed' }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'aborted'; cause: string }
  | { kind: 'blocked' }
  | { kind: 'max-tokens' }
  | { kind: 'interrupted' }
  | { kind: 'incomplete' }
  | { kind: 'other'; name: string }

/** One `--output-format json` record written after the Session flush. */
export interface HeadlessResult {
  /** Discriminator for this one-shot result record. */
  type: typeof HEADLESS_RESULT_TYPE
  /** Version of this JSON record, independent of the Session format. */
  schemaVersion: typeof HEADLESS_RESULT_SCHEMA_VERSION
  /** Whether the owned turn reached its durable completed boundary. */
  status: 'completed' | 'failed'
  /** Final assistant text, empty when the turn produced none. */
  text: string
  /** Closed public projection of the durable end reason. */
  reason: HeadlessResultReason
}

/** Outcome of one owned run interval. */
interface RunOutcome {
  text: string
  reason: TurnEndReason | undefined
}

/** Process-facing effects of one run: output streams plus the launcher's bounded exit request. */
interface HeadlessIo {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

/** The process streams the runner writes to; tests substitute captures. */
export const internals: { stdout: HeadlessIo['stdout']; stderr: HeadlessIo['stderr'] } = {
  stdout: process.stdout,
  stderr: process.stderr,
}

/** Aggregate the last assistant text and turn outcome in one owned interval. */
function summarize(events: readonly SessionEvent[], firstSeq: number): RunOutcome {
  let started = false
  let text = ''
  let reason: TurnEndReason | undefined
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason }
}

/**
 * Remove terminal controls while retaining printable Unicode, tabs, and line
 * boundaries for the explicit assistive-technology presentation.
 * @param text - untrusted model or provider text headed to a terminal.
 * @returns line-oriented text without C0/C1 controls or escape sequences.
 */
function accessibleText(text: string): string {
  const skipStringControl = (start: number): number => {
    let cursor = start
    while (cursor < text.length) {
      const current = text.charCodeAt(cursor)
      if (current === 0x07 || current === 0x9c) return cursor + 1
      if (current === 0x1b && text[cursor + 1] === '\\') return cursor + 2
      cursor += 1
    }
    return cursor
  }
  const skipControlSequence = (start: number): number => {
    let cursor = start
    while (cursor < text.length) {
      const final = text.charCodeAt(cursor)
      cursor += 1
      if (final >= 0x40 && final <= 0x7e) break
    }
    return cursor
  }
  let sanitized = ''
  let index = 0
  while (index < text.length) {
    const code = text.charCodeAt(index)
    if (code === 0x1b) {
      const family = text[index + 1]
      if (family === '[') {
        index = skipControlSequence(index + 2)
        continue
      }
      if (family === ']' || family === 'P' || family === 'X' || family === '^' || family === '_') {
        index = skipStringControl(index + 2)
        continue
      }
      index += family === undefined ? 1 : 2
      continue
    }
    if (code === 0x9b) {
      index = skipControlSequence(index + 1)
      continue
    }
    if (code === 0x90 || code === 0x98 || code === 0x9d || code === 0x9e || code === 0x9f) {
      index = skipStringControl(index + 1)
      continue
    }
    if (code === 0x0d) {
      sanitized += '\n'
      index += text.charCodeAt(index + 1) === 0x0a ? 2 : 1
      continue
    }
    if (code === 0x0a || code === 0x09) {
      sanitized += text.charAt(index)
      index += 1
      continue
    }
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      index += 1
      continue
    }
    sanitized += text.charAt(index)
    index += 1
  }
  return sanitized
}

/** Project any diagnostic into one safe status line. */
function accessibleLine(text: string): string {
  return accessibleText(text).replace(/\s+/gu, ' ').trim()
}

/** Project the merge-extensible Session reason into the versioned public record. */
function projectReason(reason: TurnEndReason | undefined): HeadlessResultReason {
  if (reason === undefined) return { kind: 'incomplete' }
  const kind: string = reason.kind
  if (kind === 'completed') return { kind: 'completed' }
  if (kind === 'error') {
    const failure = reason as Extract<TurnEndReason, { kind: 'error' }>
    return { kind: 'error', code: failure.error.code, message: failure.error.message }
  }
  if (kind === 'aborted') {
    const aborted = reason as Extract<TurnEndReason, { kind: 'aborted' }>
    return { kind: 'aborted', cause: aborted.reason.kind }
  }
  if (kind === 'blocked') return { kind: 'blocked' }
  if (kind === 'max-tokens') return { kind: 'max-tokens' }
  if (kind === 'interrupted') return { kind: 'interrupted' }
  return { kind: 'other', name: kind }
}

/** Build one public result from the flushed durable interval. */
function projectResult(outcome: RunOutcome): HeadlessResult {
  const reason = projectReason(outcome.reason)
  return {
    type: HEADLESS_RESULT_TYPE,
    schemaVersion: HEADLESS_RESULT_SCHEMA_VERSION,
    status: reason.kind === 'completed' ? 'completed' : 'failed',
    text: outcome.text,
    reason,
  }
}

/** Write one stable terminal state for the assistive-technology presentation. */
function writeAccessibleEnd(stderr: HeadlessIo['stderr'], reason: HeadlessResultReason): void {
  switch (reason.kind) {
    case 'completed':
      stderr.write('dsh: task completed\n')
      return
    case 'error':
      stderr.write(`dsh: task failed: ${accessibleLine(reason.code)}: ${accessibleLine(reason.message)}\n`)
      return
    case 'aborted':
      stderr.write(`dsh: task aborted: ${accessibleLine(reason.cause)}\n`)
      return
    case 'blocked':
      stderr.write('dsh: task blocked\n')
      return
    case 'max-tokens':
      stderr.write('dsh: task stopped at the token limit\n')
      return
    case 'interrupted':
      stderr.write('dsh: task interrupted\n')
      return
    case 'incomplete':
      stderr.write('dsh: task ended without a durable result\n')
      return
    case 'other':
      stderr.write(`dsh: task failed: ${accessibleLine(reason.name)}\n`)
      return
    /* v8 ignore next -- closed public output union exhaustiveness guard */
    default:
      return assertNever(reason, 'headless accessible result')
  }
}

/** Write one completed projection without mixing output formats. */
function writeResult(io: HeadlessIo, config: Config, result: HeadlessResult): void {
  if (config.outputFormat === 'json') {
    io.stdout.write(`${JSON.stringify(result)}\n`)
    return
  }
  io.stdout.write(`${config.accessibility ? accessibleText(result.text) : result.text}\n`)
  if (config.accessibility) {
    writeAccessibleEnd(io.stderr, result.reason)
    return
  }
  if (result.reason.kind === 'error') {
    io.stderr.write(`dsh: ${result.reason.code}: ${result.reason.message}\n`)
  }
}

/**
 * Project provider-reported reasoning from one owned run to stderr as it is
 * appended, while keeping final outcome derivation on the durable log.
 * @param ctx - plugin context carrying the Session event feed.
 * @param agent - the exact Agent whose reasoning belongs to this invocation.
 * @param stderr - progress output sink.
 * @returns a disposer that also terminates an unterminated reasoning line.
 */
function streamReasoning(
  ctx: Context,
  agent: Agent,
  stderr: HeadlessIo['stderr'],
): () => void {
  let started = false
  let open = false
  let endsWithNewline = true
  const close = (): void => {
    if (!open) return
    if (!endsWithNewline) stderr.write('\n')
    open = false
    endsWithNewline = true
  }
  const dispose = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    if (event.type === 'turn/start') {
      close()
      started = true
      return
    }
    if (!started || event.type !== 'assistant/chunk') return
    const chunk = event.data.chunk
    switch (chunk.type) {
      case 'reasoning-delta':
        if (chunk.text === '') return
        if (!open) {
          stderr.write('dsh: reasoning:\n')
          open = true
        }
        stderr.write(chunk.text)
        endsWithNewline = chunk.text.endsWith('\n')
        return
      case 'block-start':
        if (chunk.blockType !== 'reasoning') close()
        return
      case 'block-end':
        if (chunk.block.type !== 'reasoning') close()
        return
      case 'usage':
        return
      case 'text-delta':
      case 'tool-call-delta':
      case 'finish':
        close()
        return
      /* v8 ignore next -- closed-union exhaustiveness guard */
      default:
        return assertNever(chunk, 'headless reasoning stream')
    }
  })
  return () => {
    dispose()
    close()
  }
}

/** Report an unexpected direct-driver failure through the selected presentation. */
function fail(io: HeadlessIo, config: Config, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const result: HeadlessResult = {
    type: HEADLESS_RESULT_TYPE,
    schemaVersion: HEADLESS_RESULT_SCHEMA_VERSION,
    status: 'failed',
    text: '',
    reason: { kind: 'error', code: 'INTERNAL', message },
  }
  if (config.outputFormat === 'json') io.stdout.write(`${JSON.stringify(result)}\n`)
  else if (config.accessibility) writeAccessibleEnd(io.stderr, result.reason)
  else io.stderr.write(`dsh: ${message}\n`)
  io.exit(1)
}

/**
 * Run one task through a freshly created Agent and request process exit.
 * @param ctx - plugin context carrying the Agent, default model, Session, and launcher IO services.
 * @param config - one-shot task and output presentation.
 * @param io - process-facing effects.
 */
async function run(ctx: Context, config: Config, io: HeadlessIo): Promise<void> {
  if (config.accessibility && config.outputFormat === 'text') {
    io.stderr.write('dsh: task started\n')
  }
  // Loader siblings mount concurrently. Await the complete application before
  // creating an Agent so its scoped tools and adapters are not half-composed.
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  // Early process shutdown can dispose the tree while settlement is pending.
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return

  const selection = defaultModel.currentSelection()
  // This bundle composes no preset roster, so the model-facing rows sit in the
  // host plane and the agent reads them from the global layer. A deployment
  // that DOES configure one has to join it here first
  // (@deepseek-ai/dsh-agent-presets README, "Composing a child agent").
  const { agent } = await agents.create({
    sessionId: brandString<SessionId>(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx) => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
    },
  })
  await agent.whenIdle()
  const firstSeq = agent.session.seq
  const stopReasoning = config.accessibility || config.outputFormat === 'json'
    ? (): void => {}
    : streamReasoning(ctx, agent, io.stderr)
  try {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: config.task }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
  } finally {
    stopReasoning()
  }
  await sessions.flush(agent.session)
  const outcome = summarize(agent.session.events, firstSeq)
  const result = projectResult(outcome)
  writeResult(io, config, result)
  io.exit(result.status === 'completed' ? 0 : 1)
}

/**
 * Mount the one-shot direct driver.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated task config.
 */
export function apply(ctx: Context, config: Config): void {
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value, never an injected dependency.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('headless-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: HeadlessIo = { stdout: internals.stdout, stderr: internals.stderr, exit }
  void run(ctx, config, io).catch((error: unknown) => { fail(io, config, error) })
}
