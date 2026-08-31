/** Direct one-shot Agent driving, durable aggregation, flushing, and exit mapping. */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, TurnEndReason, UserMessage } from '@deepseek-ai/dsh-session'
import { apply, Config, HEADLESS_RESULT_SCHEMA_VERSION, internals } from '../src/index.ts'

const originalInternals = { ...internals }
afterEach(() => { Object.assign(internals, originalInternals) })

interface Script {
  before?(session: Session): void
  afterPrompt(session: Session, message: UserMessage): Promise<void> | void
}

function headlessConfig(overrides: Partial<Config> = {}): Config {
  return {
    task: 'do the thing',
    accessibility: false,
    outputFormat: 'text',
    ...overrides,
  }
}

function appendTurn(
  session: Session,
  turn: number,
  message: UserMessage,
  text: string | undefined,
  completed: boolean,
): void {
  appendTurnWithReason(
    session,
    turn,
    message,
    text,
    completed
      ? { kind: 'completed' }
      : { kind: 'aborted', reason: { kind: 'user' } },
  )
}

function appendTurnWithReason(
  session: Session,
  turn: number,
  message: UserMessage,
  text: string | undefined,
  reason: TurnEndReason,
): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  if (text !== undefined) {
    session.append('assistant/message', {
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text }],
        source: { provider: 'test-provider', model: 'test-model' },
      }),
    }, { surfaceOp: 'append' })
  }
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason })
}

/** Mount the real registries around a small scripted Agent factory. */
async function bench(script: Script): Promise<{
  ctx: Context
  output(): { out: string; err: string; order: string[] }
  run(config?: Partial<Config>): Promise<{ code: number; out: string; err: string; order: string[] }>
}> {
  const ctx = new Context()
  let out = ''
  let err = ''
  const order: string[] = []
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'test-provider', model: 'test-model' })
  ctx.agents.setFactory({
    async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
      const session = ctx.sessions.create(options.sessionId, {
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      let idle = Promise.resolve()
      const agent = {} as Agent
      const agentCtx = ownerCtx.extend({ agent })
      Object.assign(agent, {
        id: session.id,
        options: options.agentOptions ?? {},
        session,
        inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
        status: 'idle',
        ctx: agentCtx,
        cancel: () => {},
        runMaintenance: () => Promise.reject(new Error('not used')),
        send: () => {},
        followup: (message: UserMessage) => {
          agent.inbox.append('next-turn', message)
          idle = Promise.resolve().then(() => script.afterPrompt(session, message))
        },
        steer: () => {},
        inject: () => {},
        whenIdle: () => idle,
      } satisfies Partial<Agent>)
      await options.setup?.(agentCtx)
      script.before?.(session)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    resume: () => Promise.reject(new Error('not used')),
  })
  return {
    ctx,
    output: () => ({ out, err, order: [...order] }),
    run: async (config = {}) => {
      ctx.on('session/flush', () => { order.push('flush') })
      internals.stdout = { write: (chunk: string) => { out += chunk; return true } }
      internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
      const exited = new Promise<number>((resolve) => {
        ctx.provide('appExit', (code: number) => { order.push('exit'); resolve(code) })
      })
      apply(ctx, headlessConfig(config))
      return { code: await exited, out, err, order }
    },
  }
}

describe('headless runner', () => {
  it('aggregates the final text across the complete idle-to-idle interval and flushes before exit', async () => {
    const test = await bench({
      before(session) {
        const setupMessage = {
          role: 'user', content: [{ type: 'text', text: 'setup' }], source: { kind: 'user' }, id: 'setup',
        } as UserMessage
        appendTurn(session, 0, setupMessage, 'pre-task noise', true)
      },
      async afterPrompt(session, message) {
        await Promise.resolve()
        appendTurn(session, 1, message, '', true)
        appendTurn(session, 2, message, 'final answer', true)
      },
    })
    const result = await test.run()
    expect(result).toEqual({
      code: 0,
      out: 'final answer\n',
      err: '',
      order: ['flush', 'exit'],
    })
    await test.ctx.fiber.dispose()
  })

  it('waits for asynchronously appended events instead of racing Agent idleness', async () => {
    const test = await bench({
      afterPrompt: async (session, message) => {
        await new Promise(resolve => setTimeout(resolve, 5))
        appendTurn(session, 1, message, 'race-free answer', true)
      },
    })
    expect(await test.run()).toMatchObject({ code: 0, out: 'race-free answer\n', err: '' })
    await test.ctx.fiber.dispose()
  })

  it('streams reasoning before the Agent becomes idle and terminates its stderr line', async () => {
    const reasoningAppended = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const test = await bench({
      async afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'block-start', index: 0, blockType: 'reasoning' },
        })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'reasoning-delta', index: 0, text: '' },
        })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'reasoning-delta', index: 0, text: 'checking the workspace' },
        })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'reasoning-delta', index: 0, text: ' safely\n' },
        })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'checking the workspace safely\n' } },
        })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 2, reasoningTokens: 2 } },
        })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'block-start', index: 1, blockType: 'reasoning' },
        })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'reasoning-delta', index: 1, text: 'second pass\n' },
        })
        reasoningAppended.resolve(undefined)
        await release.promise
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'block-start', index: 2, blockType: 'text' },
        })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'text-delta', index: 2, text: 'done' },
        })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'block-end', index: 2, block: { type: 'text', text: 'done' } },
        })
        session.append('assistant/message', {
          turn: 1,
          step: 1,
          message: createAssistantMessage({
            content: [{ type: 'text', text: 'done' }],
            source: { provider: 'test-provider', model: 'test-model' },
          }),
        }, { surfaceOp: 'append' })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      },
    })
    const running = test.run()
    await reasoningAppended.promise
    const other = test.ctx.sessions.create()
    other.append('turn/start', { turn: 1 })
    other.append('step/start', { turn: 1, step: 1 })
    other.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: 'other session' },
    })
    const streamed = test.output()
    release.resolve(undefined)
    const result = await running
    expect(streamed).toEqual({
      out: '',
      err: 'dsh: reasoning:\nchecking the workspace safely\nsecond pass\n',
      order: [],
    })
    expect(result).toEqual({
      code: 0,
      out: 'done\n',
      err: 'dsh: reasoning:\nchecking the workspace safely\nsecond pass\n',
      order: ['flush', 'exit'],
    })
    await test.ctx.fiber.dispose()
  })

  it('uses bounded line-oriented output for assistive technology', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'reasoning-delta', index: 0, text: 'private token flood' },
        })
        session.append('assistant/message', {
          turn: 1,
          step: 1,
          message: createAssistantMessage({
            content: [{
              type: 'text',
              text: [
                '\x1b[31mred\x1b[0m',
                '\x1b]0;ignored title\x07',
                '\x1bPignored dcs\x1b\\',
                '\x1bXignored sos\x1b\\',
                '\x1b^ignored pm\x1b\\',
                '\x1b_ignored apc\x1b\\',
                '\x1bc',
                '\u009b2J',
                '\u0090ignored dcs\u009c',
                '\u0098ignored sos\u009c',
                '\u009dignored osc\u009c',
                '\u009eignored pm\u009c',
                '\u009fignored apc\u009c',
                '\rstandalone\n\tnext\x07\x08\x7f\x80',
                '\x1b]unterminated',
              ].join(''),
            }],
            source: { provider: 'test-provider', model: 'test-model' },
          }),
        }, { surfaceOp: 'append' })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      },
    })
    const result = await test.run({ accessibility: true })
    expect(result).toEqual({
      code: 0,
      out: 'red\nstandalone\n\tnext\n',
      err: 'dsh: task started\ndsh: task completed\n',
      order: ['flush', 'exit'],
    })
    expect(result.err).not.toContain('private token flood')
    expect(result.out + result.err).not.toContain('\x1b')
    expect(result.out + result.err).not.toContain('\r')
    expect(result.out + result.err).not.toContain('\x07')
    expect(result.out + result.err).not.toContain('\x08')
    await test.ctx.fiber.dispose()
  })

  it('discards a trailing incomplete escape without dropping preceding text', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        appendTurn(session, 1, message, 'safe\x1b', true)
      },
    })
    expect(await test.run({ accessibility: true })).toMatchObject({
      code: 0,
      out: 'safe\n',
      err: 'dsh: task started\ndsh: task completed\n',
    })
    await test.ctx.fiber.dispose()
  })

  it('prints one versioned JSON result and suppresses reasoning output', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'reasoning-delta', index: 0, text: 'do not print this' },
        })
        session.append('assistant/message', {
          turn: 1,
          step: 1,
          message: createAssistantMessage({
            content: [{ type: 'text', text: 'line one\nline two' }],
            source: { provider: 'test-provider', model: 'test-model' },
          }),
        }, { surfaceOp: 'append' })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      },
    })
    const result = await test.run({ outputFormat: 'json' })
    expect(result.code).toBe(0)
    expect(result.err).toBe('')
    expect(result.out.trimEnd().split('\n')).toHaveLength(1)
    expect(JSON.parse(result.out) as unknown).toEqual({
      type: 'dsh-headless-result',
      schemaVersion: HEADLESS_RESULT_SCHEMA_VERSION,
      status: 'completed',
      text: 'line one\nline two',
      reason: { kind: 'completed' },
    })
    await test.ctx.fiber.dispose()
  })

  it('exits 1 when the final turn does not complete', async () => {
    const test = await bench({
      afterPrompt(session, message) { appendTurn(session, 1, message, undefined, false) },
    })
    expect(await test.run()).toMatchObject({ code: 1, out: '\n', err: '' })
    await test.ctx.fiber.dispose()
  })

  it('prints the durable model failure when the final turn ends in error', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', {
          turn: 1,
          reason: { kind: 'error', error: { code: 'SERVER', message: 'provider unavailable' } },
        })
      },
    })
    expect(await test.run()).toMatchObject({
      code: 1,
      out: '\n',
      err: 'dsh: SERVER: provider unavailable\n',
    })
    await test.ctx.fiber.dispose()
  })

  it('announces one sanitized durable failure in accessibility mode', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        appendTurnWithReason(session, 1, message, undefined, {
          kind: 'error',
          error: { code: '\x1b[31mSERVER\x1b[0m', message: 'provider\r\nunavailable\x07' },
        })
      },
    })
    expect(await test.run({ accessibility: true })).toEqual({
      code: 1,
      out: '\n',
      err: 'dsh: task started\ndsh: task failed: SERVER: provider unavailable\n',
      order: ['flush', 'exit'],
    })
    await test.ctx.fiber.dispose()
  })

  it('separates an unterminated reasoning prefix from the terminal model failure', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'reasoning-delta', index: 0, text: 'trying recovery' },
        })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', {
          turn: 1,
          reason: { kind: 'error', error: { code: 'SERVER', message: 'provider unavailable' } },
        })
      },
    })
    expect(await test.run()).toMatchObject({
      code: 1,
      out: '\n',
      err: 'dsh: reasoning:\ntrying recovery\ndsh: SERVER: provider unavailable\n',
    })
    await test.ctx.fiber.dispose()
  })

  it('exits 1 when the owned interval contains no turn', async () => {
    const test = await bench({ afterPrompt: () => {} })
    expect(await test.run()).toMatchObject({ code: 1, out: '\n', err: '' })
    await test.ctx.fiber.dispose()
  })

  it('projects every non-error durable stop into the versioned JSON result', async () => {
    const cases: readonly {
      source: TurnEndReason
      expected: Record<string, string>
    }[] = [
      {
        source: { kind: 'aborted', reason: { kind: 'user' } },
        expected: { kind: 'aborted', cause: 'user' },
      },
      { source: { kind: 'blocked' }, expected: { kind: 'blocked' } },
      { source: { kind: 'max-tokens' }, expected: { kind: 'max-tokens' } },
      { source: { kind: 'interrupted' }, expected: { kind: 'interrupted' } },
    ]
    for (const scenario of cases) {
      const test = await bench({
        afterPrompt(session, message) {
          appendTurnWithReason(session, 1, message, undefined, scenario.source)
        },
      })
      const result = await test.run({ outputFormat: 'json' })
      expect(result.code).toBe(1)
      expect(result.err).toBe('')
      expect(JSON.parse(result.out) as unknown).toEqual({
        type: 'dsh-headless-result',
        schemaVersion: HEADLESS_RESULT_SCHEMA_VERSION,
        status: 'failed',
        text: '',
        reason: scenario.expected,
      })
      await test.ctx.fiber.dispose()
    }
  })

  it('reports a missing durable turn as incomplete JSON', async () => {
    const test = await bench({ afterPrompt: () => {} })
    const result = await test.run({ outputFormat: 'json' })
    expect(result).toMatchObject({ code: 1, err: '' })
    expect(JSON.parse(result.out) as unknown).toEqual({
      type: 'dsh-headless-result',
      schemaVersion: HEADLESS_RESULT_SCHEMA_VERSION,
      status: 'failed',
      text: '',
      reason: { kind: 'incomplete' },
    })
    await test.ctx.fiber.dispose()
  })

  it('announces each durable non-completed terminal state once', async () => {
    const cases: readonly {
      source?: TurnEndReason
      terminal: string
    }[] = [
      {
        source: { kind: 'aborted', reason: { kind: 'user' } },
        terminal: 'dsh: task aborted: user',
      },
      { source: { kind: 'blocked' }, terminal: 'dsh: task blocked' },
      { source: { kind: 'max-tokens' }, terminal: 'dsh: task stopped at the token limit' },
      { source: { kind: 'interrupted' }, terminal: 'dsh: task interrupted' },
      {
        source: { kind: 'extension-stop' } as unknown as TurnEndReason,
        terminal: 'dsh: task failed: extension-stop',
      },
      { terminal: 'dsh: task ended without a durable result' },
    ]
    for (const scenario of cases) {
      const test = await bench({
        afterPrompt(session, message) {
          if (scenario.source !== undefined) {
            appendTurnWithReason(session, 1, message, undefined, scenario.source)
          }
        },
      })
      expect(await test.run({ accessibility: true })).toEqual({
        code: 1,
        out: '\n',
        err: `dsh: task started\n${scenario.terminal}\n`,
        order: ['flush', 'exit'],
      })
      await test.ctx.fiber.dispose()
    }
  })

  it('reports a direct Agent creation failure', async () => {
    const ctx = new Context()
    let err = ''
    internals.stdout = { write: () => true }
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    const exited = new Promise<number>((resolve) => {
      ctx.provide('appExit', resolve)
    })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
    ctx.provide('agents', { create: () => Promise.reject(new Error('factory exploded')) } as never)
    apply(ctx, headlessConfig({ task: 't' }))
    expect(await exited).toBe(1)
    expect(err).toBe('dsh: factory exploded\n')
    await ctx.fiber.dispose()
  })

  it('keeps a direct failure machine-readable in JSON mode', async () => {
    const ctx = new Context()
    let out = ''
    let err = ''
    internals.stdout = { write: (chunk: string) => { out += chunk; return true } }
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    const exited = new Promise<number>((resolve) => {
      ctx.provide('appExit', resolve)
    })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
    ctx.provide('agents', { create: () => Promise.reject(new Error('factory exploded')) } as never)
    apply(ctx, headlessConfig({ task: 't', outputFormat: 'json' }))
    expect(await exited).toBe(1)
    expect(err).toBe('')
    expect(JSON.parse(out) as unknown).toEqual({
      type: 'dsh-headless-result',
      schemaVersion: HEADLESS_RESULT_SCHEMA_VERSION,
      status: 'failed',
      text: '',
      reason: { kind: 'error', code: 'INTERNAL', message: 'factory exploded' },
    })
    await ctx.fiber.dispose()
  })

  it('announces a direct failure once in accessibility mode', async () => {
    const ctx = new Context()
    let out = ''
    let err = ''
    internals.stdout = { write: (chunk: string) => { out += chunk; return true } }
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    const exited = new Promise<number>((resolve) => {
      ctx.provide('appExit', resolve)
    })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
    ctx.provide('agents', { create: () => Promise.reject(new Error('factory\r\nexploded\x07')) } as never)
    apply(ctx, headlessConfig({ task: 't', accessibility: true }))
    expect(await exited).toBe(1)
    expect(out).toBe('')
    expect(err).toBe('dsh: task started\ndsh: task failed: INTERNAL: factory exploded\n')
    await ctx.fiber.dispose()
  })

  it('stringifies a non-Error Agent creation failure', async () => {
    const ctx = new Context()
    let err = ''
    internals.stdout = { write: () => true }
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    const exited = new Promise<number>((resolve) => {
      ctx.provide('appExit', resolve)
    })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
    const rejected = {
      then(_resolve: (value: never) => void, reject: (reason: unknown) => void): void {
        reject('factory exploded')
      },
    }
    ctx.provide('agents', { create: () => rejected } as never)
    apply(ctx, headlessConfig({ task: 't' }))
    expect(await exited).toBe(1)
    expect(err).toBe('dsh: factory exploded\n')
    await ctx.fiber.dispose()
  })

  it('abandons a run when the tree is disposed during Loader settlement', async () => {
    const ctx = new Context()
    let exited = false
    internals.stdout = { write: () => true }
    internals.stderr = { write: () => true }
    ctx.provide('appExit', () => { exited = true })
    const services = ctx.plugin((child: Context) => {
      child.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
      child.provide('sessions', {} as never)
      child.provide('agents', {} as never)
    })
    await services
    let release: () => void
    const settlement = new Promise<void>((resolve) => { release = resolve })
    ctx.provide('loader', { await: () => settlement } as never)
    apply(ctx, headlessConfig({ task: 't' }))
    await services.dispose()
    release!()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(exited).toBe(false)
    await ctx.fiber.dispose()
  })

  it('fails loud without the launcher-provided exit request', () => {
    const ctx = new Context()
    expect(() => { apply(ctx, headlessConfig({ task: 't' })) }).toThrow('must provide ctx.appExit')
  })

  it('validates config: the task is required', () => {
    expect(() => new Config({} as never)).toThrow()
    expect(new Config({ task: 'x' } as never)).toEqual({
      task: 'x',
      accessibility: false,
      outputFormat: 'text',
    })
    expect(() => new Config({ task: 'x', outputFormat: 'xml' } as never)).toThrow()
  })
})
