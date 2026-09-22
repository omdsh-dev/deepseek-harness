import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type {
  CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactElement, ReactNode, RefObject, SyntheticEvent,
} from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { IconCheckOutlineRegular } from './icons/index.tsx'
import { overlayTopMargin } from './overlay-top-margin.ts'
import { usePointerGrace } from './pointer-grace.ts'
import css from './Menu.module.css'

/** Selectable row (optionally with a nested submenu). */
export interface MenuItem {
  id: string
  label: ReactNode
  disabled?: boolean
  /** Checked-choice semantics. Omit for an action; radio and checkbox items expose aria-checked. */
  selection?: 'radio' | 'checkbox'
  /** Leading icon (figma .Menu_cell gap 8). */
  icon?: ReactNode
  /** Destructive row: error-colored text/icon and danger hover fill. */
  danger?: boolean
  /** Nested card opened to the right on hover/focus. */
  submenu?: readonly MenuItem[]
}

/** Hairline between item groups (not selectable). */
export interface MenuSeparator {
  type: 'separator'
  id: string
}

/** Non-interactive heading row above a group of items. */
export interface MenuLabel {
  type: 'label'
  id: string
  text: string
}

/** One primary-menu entry: a row, a separator, or a heading label. */
export type MenuEntry = MenuItem | MenuSeparator | MenuLabel

/** Props for one component-rendered menu row. */
export interface MenuItemButtonProps {
  /** Visible row label. */
  children: ReactNode
  /** Leading icon (figma .Menu_cell gap 8). */
  icon?: ReactNode
  /** Whether the row cannot be activated. */
  disabled?: boolean
  /** Destructive row: error-colored text/icon and danger hover fill. */
  danger?: boolean
  /**
   * Start a new group: a hairline above this row, the same one a
   * `{ type: 'separator' }` data entry draws. It comes and goes with the row,
   * so a row that renders nothing leaves no stray line; a data separator
   * directly before it draws no second line, and the list's first row draws none.
   */
  separatorBefore?: boolean
  /** Row activation (click, Enter, or Space on the focused row). */
  onSelect: () => void
}

/**
 * Render one `role="menuitem"` row for a {@link Menu} whose rows are
 * components rather than `items` data: the same markup and styling as a data
 * row, so it joins the list's keyboard walk and post-selection focus return
 * without any shared state. Closing the menu stays the owner's decision, as
 * it is for data rows.
 * @param props.children - visible row label.
 * @param props.icon - optional leading icon.
 * @param props.disabled - whether the row cannot be activated.
 * @param props.danger - whether to use the destructive row colors.
 * @param props.separatorBefore - whether this row starts a new group (hairline above it).
 * @param props.onSelect - row activation callback.
 * @returns one menu-item row.
 */
export function MenuItemButton({
  children, icon, disabled = false, danger = false, separatorBefore = false, onSelect,
}: MenuItemButtonProps) {
  return (
    <div className={css.itemWrap}>
      {separatorBefore && <div className={css.separator} role="separator" />}
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className={clsx(css.item, danger && css.danger)}
        disabled={disabled}
        onClick={onSelect}
      >
        {icon !== undefined && <span className={css.itemIcon}>{icon}</span>}
        <span className={css.itemLabel}>{children}</span>
      </button>
    </div>
  )
}

function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return 'type' in entry && entry.type === 'separator'
}

function isLabel(entry: MenuEntry): entry is MenuLabel {
  return 'type' in entry && entry.type === 'label'
}

function menuItemRole(entry: MenuItem): 'menuitem' | 'menuitemradio' | 'menuitemcheckbox' {
  if (entry.selection === 'radio') return 'menuitemradio'
  if (entry.selection === 'checkbox') return 'menuitemcheckbox'
  return 'menuitem'
}

/** Unplaced portal list: hidden but laid out at a fixed origin so offsetWidth/offsetHeight are real. */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

const DOCUMENT_FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const MENU_ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]'

function menuItems(menu: HTMLElement): HTMLButtonElement[] {
  return [...menu.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR)]
    .filter(item => !item.disabled && item.closest('[role="menu"]') === menu)
}

function focusAt(menu: HTMLElement, at: number): void {
  const items = menuItems(menu)
  if (items.length === 0) return
  items[(at + items.length) % items.length]?.focus()
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value)
  else if (ref !== undefined && ref !== null) {
    ;(ref as React.MutableRefObject<T | null>).current = value
  }
}

/**
 * Render an anchored dropdown menu. Arrow keys move within the list; Tab and
 * Shift+Tab close without selecting and continue page traversal. Escape returns
 * focus to the trigger. Selection restores focus unless the action opens another
 * focus destination. Only keys on the trigger or inside the list are intercepted.
 * @param props.autoFocus - focus the first item on open; the arrow keys walk the list either way.
 * @param props.open - whether the list is showing (owner-controlled).
 * @param props.anchor - the trigger element (rendered in place).
 * @param props.items - selectable data rows and optional separators (default none; with no `children` either, the list is empty).
 * @param props.selectedId - row shown as selected; a row with `selection` also exposes its checked state.
 * @param props.selectedIds - rows shown as selected when a menu contains independent option groups.
 * @param props.onSelect - data-row activation callback (not called for disabled rows or submenu parents that only open children).
 * @param props.onClose - invoked on outside click, Escape, or a window blur
 * that moved focus into an iframe (the only signal a pointerdown inside a
 * cross-origin iframe leaves).
 * @param props.align - list alignment against the anchor (default 'start').
 * @param props.side - open below (`bottom`, default) or above (`top`) the anchor.
 * @param props.portal - render the list into document.body, fixed-positioned
 * from the anchor rect (repositions on scroll/resize while open). Use when an
 * ancestor's overflow clipping would crop the in-place list; default false
 * keeps the pure-CSS in-place behavior.
 * @param props.closeOnPointerLeave - close the list once the pointer has left
 * both trigger and list for the pointer grace (default false keeps it open
 * until outside click/Escape/selection). The grace makes the 4px trigger->list
 * gap and a brief overshoot survivable; coming back cancels the close.
 * @param props.dense - reduce vertical row spacing without changing the standard typography or card width.
 * @param props.compact - use reduced menu typography and spacing.
 * @param props.getAnchorRect - portal mode only: supply the anchor rect
 * directly (e.g. from a host-owned trigger button) instead of measuring the
 * Menu's own wrapper span. Required when the wrapper isn't itself laid out at
 * the trigger (render-prop anchors, effect-positioned proxies — measuring the
 * wrapper there races the host's layout effects). Called on open and on every
 * scroll/resize; return null to skip placement for that frame.
 * @param props.footer - rows pinned below the scrolling items area, separated
 * by a hairline; they stay visible while the items above scroll.
 * @param props.children - component rows rendered after `items` in the same
 * list, each a `role="menuitem"` button such as {@link MenuItemButton}; they
 * share the keyboard walk, the submenu exclusivity, and the post-selection
 * focus return.
 * @param props.selection - how a selected row is marked: a trailing check
 * (`'check'`, default — figma .Menu_cell) or the hover fill held on the row
 * with no check (`'fill'`, for icon-labelled rows where a trailing glyph
 * crowds the cell).
 * @param props.className - extra class on the anchor wrapper span.
 * @param props.listClassName - extra class on the dropdown card itself; the
 * only style hook that reaches a portaled list, which renders under
 * document.body outside the owner's DOM subtree.
 * @param props.returnFocusRef - external trigger when rendered by the owner.
 * @param props.ariaLabel - menu name when no inline trigger labels it.
 * @returns anchor wrapper with the conditional list.
 */
export function Menu({ open, anchor, items = [], children, selectedId, selectedIds, onSelect, onClose, align = 'start', side = 'bottom', portal = false, closeOnPointerLeave = false, dense = false, compact = false, autoFocus = false, selection = 'check', getAnchorRect, returnFocusRef, ariaLabel, footer, className, listClassName }: {
  open: boolean
  autoFocus?: boolean
  anchor: ReactNode
  items?: readonly MenuEntry[]
  children?: ReactNode
  footer?: readonly MenuEntry[]
  selectedId?: string | undefined
  selectedIds?: readonly string[] | undefined
  onSelect?: (id: string) => void
  onClose: () => void
  align?: 'start' | 'end'
  side?: 'bottom' | 'top' | 'right'
  portal?: boolean
  closeOnPointerLeave?: boolean
  dense?: boolean
  compact?: boolean
  selection?: 'check' | 'fill'
  getAnchorRect?: () => DOMRect | null
  /** External trigger used when `anchor` is rendered by the owner rather than this Menu. */
  returnFocusRef?: RefObject<HTMLElement | null> | undefined
  /** Menu name for an external trigger; inline anchors name the menu through aria-labelledby. */
  ariaLabel?: string | undefined
  className?: string | undefined
  listClassName?: string | undefined
}) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  /** Index the arrow walk last focused, the resume point when focus left the rows. */
  const walkIndex = useRef<number | null>(null)
  /**
   * The control that had the keyboard when this menu opened — its own trigger,
   * which an anchor that wraps several controls (a split button) would not be
   * able to name by position.
   */
  const triggerRef = useRef<HTMLElement | null>(null)

  /**
   * Hand the keyboard back to the trigger that opened the menu — or, when the
   * anchor never held it, to the anchor's first button. Focus left on a removed
   * row otherwise falls to the page body, where the next Tab restarts from the
   * top of the page.
   */
  const refocusAnchor = (): void => {
    const trigger = triggerRef.current
    if (trigger !== null && document.contains(trigger) && !(trigger as HTMLButtonElement).disabled) {
      trigger.focus()
      return
    }
    rootRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }

  /**
   * Post-selection focus, for the paths where the rows unmount with the list.
   * A selection whose owner keeps the menu open is left alone, and so is an
   * owner that moved focus itself (a presented file card hands it to its
   * preview button): only a keyboard left on the closing list (or on the body
   * its removal produced) comes back to the trigger.
   */
  const refocusAfterSelection = (): void => {
    queueMicrotask(() => {
      if (openRef.current) return
      const active = document.activeElement
      if (active === null || active === document.body || listRef.current?.contains(active) === true) refocusAnchor()
    })
  }
  const openRef = useRef(open)
  openRef.current = open
  const generatedAnchorRef = useRef<HTMLElement | null>(null)
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null)
  const [fixedPos, setFixedPos] = useState<CSSProperties | null>(null)
  const menuId = useId()
  const generatedAnchorId = useId()
  const initialEdge = useRef<1 | -1>(1)
  const pendingSubmenuFocus = useRef<string | null>(null)
  const entryFocusPending = useRef(true)
  const typeahead = useRef('')
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { arm: armClose, cancel: cancelClose } = usePointerGrace(onClose)

  const focusAnchor = (): void => {
    ;(returnFocusRef?.current ?? generatedAnchorRef.current)?.focus()
  }

  const closeAndRestore = (): void => {
    focusAnchor()
    onClose()
  }

  const movePastAnchor = (direction: 1 | -1): void => {
    const anchorElement = returnFocusRef?.current ?? generatedAnchorRef.current
    if (anchorElement === null) {
      onClose()
      return
    }
    const candidates = [...document.querySelectorAll<HTMLElement>(DOCUMENT_FOCUSABLE)]
      .filter(candidate => candidate.closest('[aria-hidden="true"]') === null
        && candidate.closest('[inert]') === null
        && !listRef.current?.contains(candidate))
    const anchorIndex = candidates.indexOf(anchorElement)
    const target = anchorIndex < 0 ? anchorElement : candidates[anchorIndex + direction] ?? anchorElement
    onClose()
    queueMicrotask(() => { target.focus() })
  }

  const selectItem = (id: string): void => {
    entryFocusPending.current = false
    const selectedFrom = document.activeElement
    onSelect?.(id)
    queueMicrotask(() => {
      if (openRef.current) return
      if (document.activeElement === selectedFrom || document.activeElement === document.body) focusAnchor()
    })
  }

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!(event.target instanceof Element)) return
    const item = event.target.closest<HTMLButtonElement>(MENU_ITEM_SELECTOR)
    if (item === null || item.disabled || !listRef.current?.contains(item)) return
    const currentMenu = item.closest<HTMLElement>('[role="menu"]')
    if (currentMenu === null) return
    const siblings = menuItems(currentMenu)
    const index = siblings.indexOf(item)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusAt(currentMenu, index + (event.key === 'ArrowDown' ? 1 : -1))
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      focusAt(currentMenu, event.key === 'Home' ? 0 : siblings.length - 1)
      return
    }
    if (event.key === 'ArrowRight') {
      const submenuId = item.dataset['submenuId']
      if (submenuId === undefined) return
      event.preventDefault()
      pendingSubmenuFocus.current = submenuId
      setOpenSubmenuId(item.dataset['menuItemId'] ?? null)
      return
    }
    if (event.key === 'ArrowLeft' && currentMenu !== listRef.current) {
      event.preventDefault()
      const parent = document.getElementById(currentMenu.getAttribute('aria-labelledby') ?? '')
      setOpenSubmenuId(null)
      if (parent instanceof HTMLElement) queueMicrotask(() => { parent.focus() })
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      if (currentMenu !== listRef.current) {
        const parent = document.getElementById(currentMenu.getAttribute('aria-labelledby') ?? '')
        setOpenSubmenuId(null)
        if (parent instanceof HTMLElement) queueMicrotask(() => { parent.focus() })
      } else closeAndRestore()
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      movePastAnchor(event.shiftKey ? -1 : 1)
      return
    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
    const typed = event.key.toLocaleLowerCase()
    const repeatedCharacter = typeahead.current.length > 0
      && Array.from(typeahead.current).every(character => character === typed)
    typeahead.current = repeatedCharacter ? typed : typeahead.current + typed
    if (typeaheadTimer.current !== null) clearTimeout(typeaheadTimer.current)
    typeaheadTimer.current = setTimeout(() => { typeahead.current = '' }, 500)
    const ordered = [...siblings.slice(index + 1), ...siblings.slice(0, index + 1)]
    const match = ordered.find(candidate => candidate.textContent.trim().toLocaleLowerCase().startsWith(typeahead.current))
    if (match !== undefined) {
      event.preventDefault()
      match.focus()
    }
  }

  useEffect(() => () => {
    if (typeaheadTimer.current !== null) clearTimeout(typeaheadTimer.current)
  }, [])

  useLayoutEffect(() => {
    const submenuId = pendingSubmenuFocus.current
    if (submenuId === null || openSubmenuId === null) return
    const submenu = document.getElementById(submenuId)
    if (submenu instanceof HTMLElement) {
      pendingSubmenuFocus.current = null
      focusAt(submenu, 0)
    }
  }, [openSubmenuId])

  useEffect(() => {
    if (!open) {
      entryFocusPending.current = true
      return
    }
    if (!entryFocusPending.current || (portal && fixedPos === null)) return
    queueMicrotask(() => {
      if (!openRef.current || !entryFocusPending.current) return
      const menu = listRef.current
      if (menu === null) return
      if (menu.contains(document.activeElement)) {
        entryFocusPending.current = false
        return
      }
      const anchorElement = returnFocusRef?.current ?? generatedAnchorRef.current
      if (document.activeElement !== document.body && document.activeElement !== anchorElement) {
        // A follow-on dialog or another owner intentionally claimed focus
        // before this deferred entry ran; the menu must not steal it back.
        entryFocusPending.current = false
        return
      }
      if (menuItems(menu).length === 0) return
      focusAt(menu, initialEdge.current === 1 ? 0 : menuItems(menu).length - 1)
      entryFocusPending.current = false
      initialEdge.current = 1
    })
  }, [fixedPos, footer, items, open, portal, returnFocusRef])

  // An owner-rendered trigger cannot receive cloned props. Keep its menu-button
  // relationship synchronized through the explicit ref, and restore any
  // owner-supplied values if this Menu leaves the tree.
  useLayoutEffect(() => {
    if (isValidElement(anchor)) return
    const externalAnchor = returnFocusRef?.current
    if (externalAnchor === null || externalAnchor === undefined) return
    const previous = {
      hasPopup: externalAnchor.getAttribute('aria-haspopup'),
      expanded: externalAnchor.getAttribute('aria-expanded'),
      controls: externalAnchor.getAttribute('aria-controls'),
    }
    return () => {
      const restore = (name: string, value: string | null): void => {
        if (value === null) externalAnchor.removeAttribute(name)
        else externalAnchor.setAttribute(name, value)
      }
      restore('aria-haspopup', previous.hasPopup)
      restore('aria-expanded', previous.expanded)
      restore('aria-controls', previous.controls)
    }
  }, [anchor, returnFocusRef])

  useLayoutEffect(() => {
    if (isValidElement(anchor)) return
    const externalAnchor = returnFocusRef?.current
    if (externalAnchor === null || externalAnchor === undefined) return
    externalAnchor.setAttribute('aria-haspopup', 'menu')
    externalAnchor.setAttribute('aria-expanded', String(open))
    if (open) externalAnchor.setAttribute('aria-controls', menuId)
    else externalAnchor.removeAttribute('aria-controls')
  }, [anchor, menuId, open, returnFocusRef])

  // Portal mode: fixed-position the list from the anchor rect before paint;
  // track the anchor while open (capture-phase scroll catches nested panes).
  // getAnchorRect trumps measuring the wrapper span: a child layout effect
  // runs before the parent's, so a wrapper the host positions in its own
  // effect measures stale here — the host callback owns the truth instead.
  useLayoutEffect(() => {
    if (!open || !portal) { setFixedPos(null); return }
    const place = () => {
      let r: DOMRect | null
      if (getAnchorRect !== undefined) {
        r = getAnchorRect()
      } else {
        /* v8 ignore next 2 -- the ref is attached before the layout effect runs and the listeners die with it. */
        r = rootRef.current?.getBoundingClientRect() ?? null
      }
      if (r === null) return
      const MARGIN = 12
      const vw = window.innerWidth
      const vh = window.innerHeight
      const listEl = listRef.current
      const lw = listEl?.offsetWidth ?? 0
      const lh = listEl?.offsetHeight ?? 0

      let x: number
      let y: number
      if (side === 'right') {
        x = r.right + 4
        y = r.top
      } else if (align === 'start') {
        x = r.left
        y = side === 'bottom' ? r.bottom + 4 : r.top - lh - 4
      } else {
        x = r.right - lw
        y = side === 'bottom' ? r.bottom + 4 : r.top - lh - 4
      }

      if (lw > 0) x = Math.min(Math.max(x, MARGIN), vw - lw - MARGIN)
      if (lh > 0) y = Math.min(Math.max(y, overlayTopMargin(MARGIN)), vh - lh - MARGIN)

      setFixedPos({ left: x, top: y })
    }
    // First run measures the hidden pre-render (same commit as `open`), so
    // end/top alignment and clamping use real dimensions before anything
    // paints — no visible jump from a zero-size first guess.
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, portal, align, side, getAnchorRect])

  // Opening remembers where the keyboard was, so closing can hand it back to
  // that control — an anchor wrapping several (a split button) cannot be asked
  // for it by position. Declared before the autoFocus effect so the capture
  // sees the trigger, not the row autoFocus is about to focus.
  useEffect(() => {
    if (!open) {
      triggerRef.current = null
      return
    }
    const active = document.activeElement
    triggerRef.current = active instanceof HTMLElement && rootRef.current?.contains(active) === true ? active : null
  }, [open])

  useEffect(() => {
    if (!open || !autoFocus) return
    const first = listRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    walkIndex.current = first === undefined || first === null ? null : 0
    first?.focus()
  }, [open, autoFocus])

  useEffect(() => {
    if (!open) {
      setOpenSubmenuId(null)
      walkIndex.current = null
      return
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return
      // The portaled list is outside the anchor subtree; check both.
      if (rootRef.current?.contains(e.target) === true) return
      if (listRef.current?.contains(e.target) === true) return
      onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        closeAndRestore()
      }
    }
    // A pointerdown inside a cross-origin iframe (a sandboxed HTML preview)
    // never reaches this document; the focus move it causes blurs the window
    // instead. Only that case closes: an app or tab switch leaves the
    // document's focus where it was, so activeElement is not an iframe.
    const onWindowBlur = () => {
      if (document.activeElement instanceof HTMLIFrameElement) onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [open, onClose, autoFocus])

  // A close from selection/Escape/outside click outruns a pending grace close;
  // left armed it would shut a list reopened inside the grace window. Its own
  // effect, not the listener effect above: that one re-runs on every `onClose`
  // identity change and would cancel the grace mid-transit.
  useEffect(() => {
    if (!open) cancelClose()
  }, [open, cancelClose])

  // The submenu card is absolutely positioned outside the list box; the
  // scroll clip would crop it, so only submenu-free menus get the height cap.
  const scrollable = !items.some(entry => !isSeparator(entry) && !isLabel(entry) && entry.submenu !== undefined && entry.submenu.length > 0)

  const renderEntry = (entry: MenuEntry) => {
    if (isSeparator(entry)) {
      return <div key={entry.id} className={css.separator} role="separator" />
    }
    if (isLabel(entry)) {
      return <div key={entry.id} className={css.label} role="presentation">{entry.text}</div>
    }
    const hasSub = entry.submenu !== undefined && entry.submenu.length > 0
    const subOpen = hasSub && openSubmenuId === entry.id
    const selected = entry.id === selectedId || selectedIds?.includes(entry.id) === true
    const role = menuItemRole(entry)
    return (
      <div
        key={entry.id}
        className={css.itemWrap}
        onMouseEnter={hasSub ? () => { setOpenSubmenuId(entry.id) } : undefined}
        onMouseLeave={() => { setOpenSubmenuId(null) }}
      >
        <button
          type="button"
          role={role}
          aria-checked={entry.selection === undefined ? undefined : selected}
          className={clsx(css.item, selected && (selection === 'fill' ? css.selectedFill : css.selected), entry.danger === true && css.danger)}
          disabled={entry.disabled}
          aria-haspopup={hasSub ? 'menu' : undefined}
          aria-expanded={hasSub ? subOpen : undefined}
          id={`${menuId}-item-${encodeURIComponent(entry.id)}`}
          tabIndex={-1}
          data-menu-item-id={entry.id}
          data-submenu-id={hasSub ? `${menuId}-submenu-${encodeURIComponent(entry.id)}` : undefined}
          onClick={() => {
            if (hasSub) {
              pendingSubmenuFocus.current = `${menuId}-submenu-${encodeURIComponent(entry.id)}`
              setOpenSubmenuId(entry.id)
              return
            }
            selectItem(entry.id)
          }}
        >
          {entry.icon !== undefined && <span className={css.itemIcon}>{entry.icon}</span>}
          <span className={css.itemLabel}>{entry.label}</span>
          {/* Selection marker is a trailing check (figma .Menu_cell), not a fill. */}
          {selected && selection === 'check' && <span className={css.check} aria-hidden="true"><IconCheckOutlineRegular /></span>}
        </button>
        {subOpen && entry.submenu !== undefined && (
          <div
            id={`${menuId}-submenu-${encodeURIComponent(entry.id)}`}
            className={clsx(css.submenu, compact && css.compactList)}
            role="menu"
            aria-labelledby={`${menuId}-item-${encodeURIComponent(entry.id)}`}
          >
            {entry.submenu.map((sub) => {
              const subSelected = sub.id === selectedId || selectedIds?.includes(sub.id) === true
              const subRole = menuItemRole(sub)
              return (
                <button
                  key={sub.id}
                  type="button"
                  role={subRole}
                  aria-checked={sub.selection === undefined ? undefined : subSelected}
                  tabIndex={-1}
                  className={clsx(css.item, subSelected && css.selected)}
                  disabled={sub.disabled}
                  onClick={() => { selectItem(sub.id) }}
                >
                  {sub.icon !== undefined && <span className={css.itemIcon}>{sub.icon}</span>}
                  <span className={css.itemLabel}>{sub.label}</span>
                  {subSelected && <span className={css.check} aria-hidden="true"><IconCheckOutlineRegular /></span>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // Submenu exclusivity is decided from the list's own bubble, by DOM:
  // reaching a top-level row that is not a submenu parent — by pointer or by
  // focus, data row or component row — closes the open card. A parent opens
  // its card in its own handlers; rows inside the card are not top-level rows.
  const collapseSubmenuFrom = (e: SyntheticEvent<HTMLDivElement>): void => {
    const row = e.target instanceof Element ? e.target.closest('button[role="menuitem"]') : null
    if (row === null || row.getAttribute('aria-haspopup') === 'menu') return
    if (row.closest('[role="menu"]') !== e.currentTarget) return
    setOpenSubmenuId(null)
  }

  // Portal lists render hidden until placed: the placement effect measures
  // this pre-render in the same commit, so the first painted frame is
  // already at the final position (with getAnchorRect returning null the
  // list simply stays hidden).
  const list = open && (
    <div
      ref={listRef}
      className={clsx(css.list, listClassName, dense && css.denseList, compact && css.compactList, scrollable && css.scrollable, portal && css.portal, side === 'top' && !portal && css.sideTop, align === 'end' && !portal && css.alignEnd)}
      style={portal ? fixedPos ?? MEASURE_STYLE : undefined}
      role="menu"
      id={menuId}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel === undefined && isValidElement(anchor)
        ? ((anchor.props as { id?: string }).id ?? generatedAnchorId)
        : undefined}
      onKeyDown={onMenuKeyDown}
      // React portals bubble synthetic events through the REACT tree: without
      // this stop, an item click re-fires the anchor row's own onClick
      // (open/toggle) after onSelect. The same bubble is where every row's
      // activation lands — data rows and component rows alike — so the
      // post-selection focus return is decided once here, after the row's
      // own handler ran; a submenu parent only opened its card.
      onClick={(e) => {
        entryFocusPending.current = false
        e.stopPropagation()
        const row = e.target instanceof Element ? e.target.closest('button[role="menuitem"]') : null
        if (row !== null && row.getAttribute('aria-haspopup') !== 'menu') refocusAfterSelection()
      }}
      onMouseOver={collapseSubmenuFrom}
      onFocus={collapseSubmenuFrom}
    >
      <div className={css.viewport} role="presentation">
        {items.map(renderEntry)}
        {children}
      </div>
      {footer !== undefined && footer.length > 0 && (
        <div className={css.footer} role="presentation">
          {footer.map(renderEntry)}
        </div>
      )}
    </div>
  )

  let renderedAnchor = anchor
  if (isValidElement(anchor)) {
    const element = anchor as ReactElement<{
      id?: string
      ref?: React.Ref<HTMLElement> | undefined
      onKeyDown?: ((event: ReactKeyboardEvent<HTMLElement>) => void) | undefined
      'aria-haspopup'?: string | undefined
      'aria-expanded'?: boolean | undefined
      'aria-controls'?: string | undefined
    }>
    const anchorId = element.props.id ?? generatedAnchorId
    const existingRef = (element as ReactElement & { ref?: React.Ref<HTMLElement> | undefined }).ref
    renderedAnchor = cloneElement(element, {
      id: anchorId,
      ref: (node: HTMLElement | null) => {
        generatedAnchorRef.current = node
        assignRef(existingRef, node)
      },
      'aria-haspopup': element.props['aria-haspopup'] ?? 'menu',
      'aria-expanded': open,
      'aria-controls': open ? menuId : undefined,
      onKeyDown: (event) => {
        element.props.onKeyDown?.(event)
        if (event.defaultPrevented) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || (open && (event.key === 'Home' || event.key === 'End'))) {
          event.preventDefault()
          initialEdge.current = event.key === 'ArrowDown' || event.key === 'Home' ? 1 : -1
          if (open) {
            const menu = listRef.current
            if (menu !== null) focusAt(menu, initialEdge.current === 1 ? 0 : menuItems(menu).length - 1)
          } else if (event.currentTarget instanceof HTMLElement) event.currentTarget.click()
        } else if (event.key === 'Escape' && open) {
          event.preventDefault()
          closeAndRestore()
        } else if (event.key === 'Tab' && open) {
          onClose()
        }
      },
    })
  }

  // Pointer-leave dismissal watches the WRAPPER, not the list: React's
  // enter/leave traversal runs over the React tree, so trigger and portaled
  // list are one region here. Aiming back at the trigger, or crossing the 4px
  // gap between them, therefore never counts as leaving.
  return (
    <span
      ref={rootRef}
      className={clsx(css.root, className)}
      onPointerEnter={closeOnPointerLeave ? cancelClose : undefined}
      onPointerLeave={closeOnPointerLeave ? () => { if (open) armClose() } : undefined}
    >
      {renderedAnchor}
      {portal ? (list !== false && createPortal(list, document.body)) : list}
    </span>
  )
}
