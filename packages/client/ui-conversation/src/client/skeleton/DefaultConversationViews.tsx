import { useEffect } from 'react'
import type { ConversationSessionSlotProps } from '../contract/slots.ts'
import { conversationPhase } from '../contract/snapshot.ts'
import { resolveActiveView } from '../view-selection.ts'
import css from './ConversationRoot.module.css'

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function DefaultConversationViews({
  view, viewTabGroupId, useSession, useConversation, useConversationViews, useInput, inputActions, useStore, actions,
  renderSlot, bindDraftMirror, openView, useInspectCall,
}: ConversationSessionSlotProps) {
  const tabs = useConversationViews(value => value)
  const inspectCall = useInspectCall(value => value)
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const inputState = useInput(s => s)
  const storedDraft = useStore(s => s.draft)
  const viewRequest = useStore(s => s.viewRequest ?? null)

  useEffect(() => {
    if (inputState.draft === '' && storedDraft !== '') inputActions.setDraft(storedDraft)
    const unmirror = bindDraftMirror(actions.setDraft)
    return () => { unmirror() }
    // Mount-only (deps pinned to inputActions): later store writes come from
    // the machine mirror, not this seed effect.
  }, [inputActions])

  if (session.blank && conversationPhase(session, conversation) === 'blank') return null
  const viewId = view ?? active?.id
  const activeView = viewId === undefined ? null : renderSlot('conversation.view', {
    inspectCall,
    viewRequest,
    openView,
    completeViewRequest: actions.completeViewRequest,
  }, { only: viewId })
  const linkedTabs = view === undefined && viewTabGroupId !== undefined && tabs.length > 1
  return (
    <div className={css.viewArea}>
      {linkedTabs ? tabs.map(tab => (
        <div
          key={tab.id}
          id={`dsh-conversation-view-panel-${encodeURIComponent(viewTabGroupId)}-${encodeURIComponent(tab.id)}`}
          className={css.viewPanel}
          role="tabpanel"
          aria-labelledby={`dsh-conversation-view-tab-${encodeURIComponent(viewTabGroupId)}-${encodeURIComponent(tab.id)}`}
          tabIndex={0}
          hidden={tab.id !== viewId}
        >
          {tab.id === viewId && activeView}
        </div>
      )) : (
        <div className={css.viewPanel} role="region" aria-label={tabs.find(tab => tab.id === viewId)?.label}>
          {activeView}
        </div>
      )}
    </div>
  )
}
