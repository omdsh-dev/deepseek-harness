/**
 * Move an explicit expand/collapse gesture to its surviving same-session control.
 * @param source - control activated by the user before the state transition.
 * @param expanded - whether the requested destination is the open panel.
 */
export function transferSidebarFocus(source: HTMLElement, expanded: boolean): void {
  const session = source.dataset['sidebarRightSession']
  queueMicrotask(() => {
    // A newer dialog or navigation owns focus if it moved during the action.
    const active = document.activeElement
    if (active !== source && active !== document.body) return
    const selector = expanded ? '[data-sidebar-right-toggle]' : '[data-sidebar-right-expand]'
    const target = [...document.querySelectorAll<HTMLElement>(selector)]
      .find(element => element.dataset['sidebarRightSession'] === session)
    target?.focus({ preventScroll: true })
  })
}
