import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionPendingInteractionBase } from '@deepseek-ai/dsh-client-ui-session/client'
import type { ConversationTimelineSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type {
  ConversationNode, RunningToolCall, ToolResultNode,
} from '../contract/snapshot.ts'
import a11yCss from './accessibility.module.css'

type ToolActivityState = 'running' | 'completed' | 'failed' | 'stopped'

interface ToolActivity {
  readonly id: string
  readonly name: string
  readonly state: ToolActivityState
}

interface ActivityBaseline {
  readonly sessionId: ChatViewSlotProps['sessionId']
  readonly ready: boolean
  readonly running: boolean
  readonly tools: ReadonlyMap<string, ToolActivity>
  readonly pendingKey: string | null
  responseStartMarker: string | null
  awaitingResponseEnd: boolean
}

interface LiveMessage {
  readonly serial: number
  readonly text: string
}

function settledToolState(result: ToolResultNode): ToolActivityState {
  if (result.error?.code === 'interrupted') return 'stopped'
  return result.isError ? 'failed' : 'completed'
}

/** Root-call lifecycle snapshot. Nested dispatches stay in their owning card so
 * parallel internals cannot flood the session-level live region. */
function toolActivities(
  nodes: readonly ConversationNode[],
  runningCalls: readonly RunningToolCall[],
): ReadonlyMap<string, ToolActivity> {
  const tools = new Map<string, ToolActivity>()
  for (const node of nodes) {
    if (node.kind !== 'tool-result' || node.parentCallId !== undefined) continue
    tools.set(node.callId, {
      id: node.callId,
      name: node.call?.name.trim() ?? '',
      state: settledToolState(node),
    })
  }
  for (const call of runningCalls) {
    if (call.parentCallId !== undefined || tools.has(call.callId)) continue
    tools.set(call.callId, {
      id: call.callId,
      name: call.name.trim(),
      state: 'running',
    })
  }
  return tools
}

type ResponseOutcome = 'completed' | 'failed' | 'limited' | 'stopped' | 'blocked' | 'ended'

interface ResponseTerminal {
  readonly marker: string
  readonly outcome: ResponseOutcome
}

function turnOutcome(reason: string): ResponseOutcome {
  switch (reason) {
    case 'completed': return 'completed'
    case 'error': return 'failed'
    case 'max-tokens': return 'limited'
    case 'aborted':
    case 'interrupted': return 'stopped'
    case 'blocked': return 'blocked'
    default: return 'ended'
  }
}

/** The newest durable terminal boundary. A response does not settle until a
 * boundary newer than the one visible when that response started is present. */
function responseTerminal(
  nodes: readonly ConversationNode[],
  timeline: ConversationTimelineSnapshot,
): ResponseTerminal | null {
  for (let index = timeline.turnOrder.length - 1; index >= 0; index -= 1) {
    const turnNumber = timeline.turnOrder[index]
    if (turnNumber === undefined) continue
    const end = timeline.turns.get(turnNumber)?.end
    if (end !== undefined) {
      return {
        marker: `turn:${String(turnNumber)}:${String(end.seq)}`,
        outcome: turnOutcome(end.data.reason.kind),
      }
    }
  }
  // Unit and compatibility fixtures without Timeline boundaries retain a
  // deterministic Node marker; production Sessions use the branch above.
  if (timeline.turnOrder.length > 0) return null
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (node?.kind === 'turn-error') return { marker: `node:${String(node.seq)}`, outcome: 'failed' }
    if (node?.kind === 'turn-max-tokens') return { marker: `node:${String(node.seq)}`, outcome: 'limited' }
    if (node?.kind === 'assistant' && node.interrupted === true) {
      return { marker: `node:${String(node.seq)}`, outcome: 'stopped' }
    }
    if (node?.kind === 'user') break
  }
  const tail = nodes.at(-1)
  return tail === undefined ? null : { marker: `node:${String(tail.seq)}`, outcome: 'completed' }
}

function toolAnnouncement(
  tool: ToolActivity,
  t: ChatViewSlotProps['t'],
): string {
  const name = tool.name === '' ? t('chat.announcement.tool.generic') : tool.name
  switch (tool.state) {
    case 'running': return t('chat.announcement.tool.started', { tool: name })
    case 'completed': return t('chat.announcement.tool.completed', { tool: name })
    case 'failed': return t('chat.announcement.tool.failed', { tool: name })
    case 'stopped': return t('chat.announcement.tool.stopped', { tool: name })
  }
}

function pendingAnnouncement(
  interaction: Pick<SessionPendingInteractionBase, 'kind'>,
  t: ChatViewSlotProps['t'],
): string {
  switch (interaction.kind) {
    case 'approval': return t('chat.announcement.interaction.approval')
    case 'question': return t('chat.announcement.interaction.question')
    case 'plan-review': return t('chat.announcement.interaction.planReview')
    default: return t('chat.announcement.interaction.generic')
  }
}

/** One stable, deduplicated polite live region for session activity. */
export function LiveAnnouncements({
  sessionId,
  ready,
  running,
  nodes,
  timeline,
  runningCalls,
  pendingInteraction,
  t,
}: {
  readonly sessionId: ChatViewSlotProps['sessionId']
  readonly ready: boolean
  readonly running: boolean
  readonly nodes: readonly ConversationNode[]
  readonly timeline: ConversationTimelineSnapshot
  readonly runningCalls: readonly RunningToolCall[]
  readonly pendingInteraction: SessionPendingInteractionBase | undefined
  readonly t: ChatViewSlotProps['t']
}) {
  const tools = useMemo(() => toolActivities(nodes, runningCalls), [nodes, runningCalls])
  const terminal = useMemo(() => responseTerminal(nodes, timeline), [nodes, timeline])
  const previous = useRef<ActivityBaseline | null>(null)
  const [message, setMessage] = useState<LiveMessage>({ serial: 0, text: '' })

  useEffect(() => {
    const next: ActivityBaseline = {
      sessionId,
      ready,
      running,
      tools,
      pendingKey: pendingInteraction?.key ?? null,
      responseStartMarker: previous.current === null
        ? terminal?.marker ?? null
        : previous.current.responseStartMarker,
      awaitingResponseEnd: previous.current?.awaitingResponseEnd ?? false,
    }
    const prior = previous.current
    previous.current = next

    // Loading history and switching/mounting Sessions only establish a
    // baseline. Historical state must not be replayed as fresh activity.
    if (!ready || prior === null || !prior.ready || prior.sessionId !== sessionId) {
      next.responseStartMarker = terminal?.marker ?? null
      next.awaitingResponseEnd = false
      setMessage(current => current.text === ''
        ? current
        : { serial: current.serial + 1, text: '' })
      return
    }

    const announcements: string[] = []
    if (!prior.running && running) {
      announcements.push(t('chat.announcement.response.started'))
      next.responseStartMarker = terminal?.marker ?? null
      next.awaitingResponseEnd = false
    }

    for (const tool of tools.values()) {
      const old = prior.tools.get(tool.id)
      if (old === undefined) {
        if (tool.state === 'running') announcements.push(toolAnnouncement(tool, t))
        continue
      }
      if (old.state === 'running' && tool.state !== 'running') {
        announcements.push(toolAnnouncement(tool, t))
      }
    }

    if (prior.running && !running) next.awaitingResponseEnd = true
    if (!running && next.awaitingResponseEnd
      && terminal !== null && terminal.marker !== next.responseStartMarker) {
      announcements.push(t(`chat.announcement.response.${terminal.outcome}`))
      next.responseStartMarker = terminal.marker
      next.awaitingResponseEnd = false
    }
    if (pendingInteraction !== undefined && prior.pendingKey !== pendingInteraction.key) {
      announcements.push(pendingAnnouncement(pendingInteraction, t))
    }
    if (announcements.length === 0) return
    setMessage(current => ({
      serial: current.serial + 1,
      text: announcements.join(' '),
    }))
  }, [pendingInteraction, ready, running, sessionId, t, terminal, tools])

  return (
    <div
      className={a11yCss.visuallyHidden}
      data-chat-announcer=""
      aria-live="polite"
      aria-atomic="true"
      aria-relevant="additions text"
    >
      {message.text === '' ? null : <span key={message.serial}>{message.text}</span>}
    </div>
  )
}
