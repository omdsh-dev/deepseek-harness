import type { KeyboardEvent } from 'react'

/**
 * Own horizontal tab-list movement and move DOM focus with the active tab.
 * The caller supplies the non-empty ordered tab ledger and its activation rule.
 */
export function moveHorizontalTabFocus<Item, Target extends HTMLElement>(
  event: KeyboardEvent<Target>,
  tabs: readonly Item[],
  currentIndex: number,
  activate: (tab: Item) => void,
): void {
  let nextIndex: number
  switch (event.key) {
    case 'ArrowRight': nextIndex = (currentIndex + 1) % tabs.length; break
    case 'ArrowLeft': nextIndex = (currentIndex - 1 + tabs.length) % tabs.length; break
    case 'Home': nextIndex = 0; break
    case 'End': nextIndex = tabs.length - 1; break
    default: return
  }
  event.preventDefault()
  activate(tabs[nextIndex] as Item)
  event.currentTarget.parentElement
    ?.querySelectorAll<HTMLElement>('[role="tab"]')
    .item(nextIndex)
    .focus()
}
