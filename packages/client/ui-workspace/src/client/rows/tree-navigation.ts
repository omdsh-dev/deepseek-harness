import { useLayoutEffect, useRef } from 'react'
import type {
  FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'

/** Return every rendered row in DOM order for one composite tree. */
function renderedTreeItems(tree: HTMLElement): HTMLElement[] {
  return [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')]
}

/** Maintain the tree's one roving row and the actions owned by that row. */
function setRovingTreeItem(items: readonly HTMLElement[], active: HTMLElement): void {
  for (const item of items) {
    const current = item === active
    item.tabIndex = current ? 0 : -1
    for (const action of item.querySelectorAll<HTMLButtonElement>('button')) {
      action.tabIndex = current ? 0 : -1
    }
  }
}

/** Case-insensitive row label used by the APG-recommended type-ahead behavior. */
function treeItemLabel(item: HTMLElement): string {
  return (item.dataset.treeLabel ?? '').trim().toLocaleLowerCase()
}

/**
 * APG-style keyboard behavior shared by grouped, flat, and search trees.
 * One row participates in Tab order; arrows move within the composite,
 * Enter/Space activate a row, Left/Right operate Workspace disclosure, and
 * printable characters move to the next row whose owned label starts with
 * the buffered text.
 */
export function useTreeKeyboardNavigation() {
  const treeRef = useRef<HTMLDivElement | null>(null)
  const typeAhead = useRef({ value: '', lastAt: 0 })

  useLayoutEffect(() => {
    const tree = treeRef.current
    if (tree === null) return
    const items = renderedTreeItems(tree)
    const first = items[0]
    if (first === undefined) return
    const focused = document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>('[role="treeitem"]')
      : null
    const active = focused !== null && tree.contains(focused)
      ? focused
      : items.find(item => item.getAttribute('aria-selected') === 'true')
        ?? items.find(item => item.tabIndex === 0)
        ?? first
    setRovingTreeItem(items, active)
  })

  const promote = (target: EventTarget | null): HTMLElement | null => {
    const tree = treeRef.current
    if (!(target instanceof HTMLElement) || tree === null) return null
    const item = target.closest<HTMLElement>('[role="treeitem"]')
    if (item === null || !tree.contains(item)) return null
    setRovingTreeItem(renderedTreeItems(tree), item)
    return item
  }

  const onFocusCapture = (event: ReactFocusEvent<HTMLDivElement>): void => {
    promote(event.target)
  }
  const onPointerDownCapture = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.target instanceof HTMLElement
      && event.target.closest('button, a, input, select, textarea') !== null) return
    promote(event.target)?.focus({ preventScroll: true })
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const tree = treeRef.current
    if (tree === null || !(event.target instanceof HTMLElement)) return
    const item = event.target.closest<HTMLElement>('[role="treeitem"]')
    // Child row actions retain their native keyboard behavior.
    if (item === null || event.target !== item || !tree.contains(item)) return
    const items = renderedTreeItems(tree)
    const index = items.indexOf(item)
    let destination: HTMLElement | undefined
    if (event.key === 'ArrowDown') destination = items[index + 1]
    else if (event.key === 'ArrowUp') destination = items[index - 1]
    else if (event.key === 'Home') destination = items[0]
    else if (event.key === 'End') destination = items.at(-1)
    else if (event.key === 'ArrowRight') {
      if (item.getAttribute('aria-expanded') === 'false') {
        event.preventDefault()
        item.click()
        return
      }
      if (item.getAttribute('aria-expanded') === 'true') {
        const next = items[index + 1]
        const level = Number(item.getAttribute('aria-level') ?? '1')
        if (next !== undefined
          && Number(next.getAttribute('aria-level') ?? '1') > level) destination = next
      }
    } else if (event.key === 'ArrowLeft') {
      if (item.getAttribute('aria-expanded') === 'true') {
        event.preventDefault()
        item.click()
        return
      }
      const level = Number(item.getAttribute('aria-level') ?? '1')
      destination = items.slice(0, index).reverse().find(candidate => (
        Number(candidate.getAttribute('aria-level') ?? '1') < level
      ))
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      item.click()
      return
    } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const now = Date.now()
      const previous = now - typeAhead.current.lastAt <= 500 ? typeAhead.current.value : ''
      const buffered = `${previous}${event.key}`.toLocaleLowerCase()
      typeAhead.current = { value: buffered, lastAt: now }
      const firstCharacter = buffered.charAt(0)
      const repeatedCharacter = buffered === firstCharacter.repeat(buffered.length)
      const query = repeatedCharacter ? firstCharacter : buffered
      destination = [...items.slice(index + 1), ...items.slice(0, index + 1)]
        .find(candidate => treeItemLabel(candidate).startsWith(query))
    } else return
    if (destination === undefined) return
    event.preventDefault()
    setRovingTreeItem(items, destination)
    destination.focus({ preventScroll: true })
  }

  return { ref: treeRef, onFocusCapture, onPointerDownCapture, onKeyDown }
}
