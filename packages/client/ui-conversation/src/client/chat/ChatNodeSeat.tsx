import { memo, useMemo } from 'react'
import { JsonBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import css from './ChatView.module.css'

interface ChatNodeSeatProps extends ChatNodeOwnerProps {
  readonly nodeKey: string
  readonly useSession: ChatViewSlotProps['useSession']
  readonly renderSlot: ChatViewSlotProps['renderSlot']
  readonly t: ChatViewSlotProps['t']
}

type RoutedChatNodeOwner = {
  [Kind in ChatNode['kind']]: ChatNodeOwnerProps & { readonly node: ChatNode<Kind> }
}[ChatNode['kind']]

/** Subscribe and dispatch one stable Context key without observing sibling Nodes. */
export const ChatNodeSeat = memo(function ChatNodeSeat({
  nodeKey, selectedCallId, cwd, openFile, inspectCall, forkAt,
  renderMessageImages, fileMentions, useSession, renderSlot, t,
}: ChatNodeSeatProps) {
  const node = useSession(snapshot => snapshot.chat.nodes.get(nodeKey))
  const routedNode = node as ChatNode | undefined
  const owner = useMemo<ChatNodeOwnerProps | null>(() => node === undefined
    ? null
    : {
      selectedCallId,
      cwd,
      openFile,
      inspectCall,
      forkAt,
      renderMessageImages,
      fileMentions,
    }, [
    node, selectedCallId, cwd, openFile, inspectCall, forkAt, renderMessageImages, fileMentions,
  ])
  if (routedNode === undefined || owner === null) return null
  // Runtime dispatch owns the correlation: every Node's discriminant is the
  // keyed-slot entry passed alongside that same Node. TypeScript does not
  // distribute an object containing a union into a union of objects itself.
  const routedOwner = { ...owner, node: routedNode } as RoutedChatNodeOwner
  const rowLabel = routedNode.kind === 'user'
    ? t('message.user')
    : routedNode.kind === 'steering'
      ? t('message.steering')
      : routedNode.kind === 'assistant-step'
        ? t('message.assistant')
        : undefined
  return (
    <div
      className={css.flowItem}
      role="article"
      aria-label={rowLabel}
      data-chat-anchor-key={routedNode.key}
      data-chat-flow-key={routedNode.key}
      data-chat-flow-kind={routedNode.kind}
    >
      {renderSlot('conversation.chat.node', routedOwner, {
        entryKey: routedNode.kind,
        hookContext: nodeKey,
        fallback: (
          <JsonBlock
            label={t('message.unknownSurface', { type: routedNode.kind })}
            payload={routedNode.data}
            truncatedLabel={total => t('json.truncated', { total })}
          />
        ),
      })}
    </div>
  )
})
