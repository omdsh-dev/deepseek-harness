/** Shared modal keyboard ownership and focus lifetime. */
import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { observeComposition } from './keyboard-composition.ts'
import { focusWithoutRing } from './focus.ts'

/** Dialog and menu elements whose document order determines foreground shortcut ownership. */
export const modalSelector = '[role="dialog"][aria-modal="true"], [role="menu"]'

interface ModalLayer {
  element: HTMLElement
  close: () => void
  previousInert: boolean
}

interface ModalState {
  layers: ModalLayer[]
  background: { element: HTMLElement; previousInert: boolean } | null
}

const documents = new WeakMap<Document, ModalState>()

function syncInertness(state: ModalState): void {
  const top = state.layers.at(-1)
  for (const layer of state.layers) layer.element.inert = layer === top ? layer.previousInert : true
}

/**
 * Request closure of the foreground registered modal using its current onClose callback.
 * A newer menu or unregistered dialog blocks dismissal of the modal behind it.
 * @param document - product document whose modal owns the close command.
 */
export function closeTopModal(document: Document): void {
  const top = documents.get(document)?.layers.at(-1)
  if (top === undefined) return
  const foreground = [...document.querySelectorAll(modalSelector)].at(-1)
  if (foreground === top.element) top.close()
}
/**
 * Whether an anchor belongs behind the current modal and must yield keyboard input.
 * @param anchor - local control owning the input handler.
 * @returns true when another modal owns the foreground.
 */
export function isBehindModal(anchor: HTMLElement | null): boolean {
  if (anchor === null) return false
  const top = documents.get(anchor.ownerDocument)?.layers.at(-1)
  return top !== undefined && !top.element.contains(anchor)
}

const focusable = 'button, input, textarea, select, a[href], area[href], [contenteditable="true"], [tabindex]'

function focusableElements(element: HTMLElement): HTMLElement[] {
  return [...element.querySelectorAll<HTMLElement>(focusable)]
    .filter(item => !item.matches(':disabled, [type="hidden"]')
      && (item.tabIndex >= 0 || (item.isContentEditable && !item.hasAttribute('tabindex')))
      && !item.closest('[inert], [hidden], [aria-hidden="true"]'))
}

/**
 * Give only the top modal Escape and Tab ownership, then restore its previous focus.
 * Automatic entry and return focus omit outlines; keyboard traversal retains its indicators.
 * Controls mounted with the dialog use data-modal-autofocus for initial focus;
 * React autoFocus runs before this layer can capture the invoking control.
 * Local menus handle their Escape during capture before this bubble listener.
 * @param dialog - mounted dialog element.
 * @param open - whether this layer is active.
 * @param onClose - top-layer Escape or application close action.
 * @param initialFocusRef - optional contained entry target, including a non-tabbable heading.
 * @param restoreFocusRef - optional connected return target; otherwise restore the invoking control.
 */
export function useModalLayer(
  dialog: RefObject<HTMLElement | null>, open: boolean, onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>, restoreFocusRef?: RefObject<HTMLElement | null>,
): void {
  const close = useRef(onClose)
  close.current = onClose
  const invoker = useRef<HTMLElement | null>(null)
  // Capture before descendant autoFocus runs; older consumers still use it.
  if (!open) invoker.current = null
  else if (dialog.current === null && invoker.current === null
    && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    invoker.current = document.activeElement
  }
  useLayoutEffect(() => {
    const element = dialog.current
    if (!open || element === null) return
    const document = element.ownerDocument
    const composition = observeComposition(document)
    const previous = invoker.current ?? document.activeElement
    let state = documents.get(document)
    if (state === undefined) {
      const root = document.getElementById('root')
      state = { layers: [], background: root === null ? null : { element: root, previousInert: root.inert } }
      if (root !== null) root.inert = true
      documents.set(document, state)
    }
    const stack = state.layers
    const layer = { element, close: () => { close.current() }, previousInert: element.inert }
    stack.push(layer)
    syncInertness(state)
    const requested = initialFocusRef?.current
    const explicit = requested != null && element.contains(requested) ? requested : null
    const initial = explicit ?? element.querySelector<HTMLElement>('[data-modal-autofocus]')
      ?? focusableElements(element)[0] ?? element
    if (explicit !== null || !element.contains(document.activeElement)) focusWithoutRing(initial)
    const keydown = (event: KeyboardEvent): void => {
      const composing = composition.guards(event)
      if (stack.at(-1) !== layer || event.defaultPrevented || composing
        || event.ctrlKey || event.metaKey || (event.altKey && event.key !== 'Tab')) return
      if (event.key === 'Escape' && !event.shiftKey) {
        event.preventDefault()
        if (!event.repeat) close.current()
      }
      if (event.key !== 'Tab') return
      // Portaled menus own their traversal while they contain focus.
      if (document.activeElement?.closest('[role="menu"]')) return
      const items = focusableElements(element)
      const first = items[0] ?? element
      const last = items.at(-1) ?? element
      const atEdge = event.shiftKey ? document.activeElement === first : document.activeElement === last
      const active = document.activeElement
      if (active === element || !element.contains(active) || active?.getAttribute('tabindex') === '-1' || atEdge) {
        event.preventDefault()
        const target = event.shiftKey ? last : first
        target.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      composition.dispose()
      const wasTop = stack.at(-1) === layer
      stack.splice(stack.indexOf(layer), 1)
      element.inert = layer.previousInert
      syncInertness(state)
      document.removeEventListener('keydown', keydown)
      if (stack.length === 0) {
        if (state.background !== null) state.background.element.inert = state.background.previousInert
        documents.delete(document)
      }
      if (wasTop) {
        const requested = restoreFocusRef?.current
        const target = requested?.isConnected === true ? requested
          : previous instanceof HTMLElement && previous.isConnected ? previous : stack.at(-1)?.element
        if (target !== undefined) focusWithoutRing(target)
      }
    }
  }, [dialog, open, initialFocusRef, restoreFocusRef])
}
