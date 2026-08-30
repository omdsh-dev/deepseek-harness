import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type {
  CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactElement, ReactNode, RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { IconCheckOutline16 } from './icons/index.tsx'
import { usePointerGrace } from './pointer-grace.ts'
import css from './Menu.module.css'

/** Selectable row (optionally with a nested submenu). */
export interface MenuItem {
  id: string
  label: ReactNode
  disabled?: boolean
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

function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return 'type' in entry && entry.type === 'separator'
}

function isLabel(entry: MenuEntry): entry is MenuLabel {
  return 'type' in entry && entry.type === 'label'
}

/** Unplaced portal list: hidden but laid out at a fixed origin so offsetWidth/offsetHeight are real. */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

const DOCUMENT_FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function menuItems(menu: HTMLElement): HTMLButtonElement[] {
  return [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
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
 * Render an anchored dropdown menu.
 * @param props.open - whether the list is showing (owner-controlled).
 * @param props.anchor - the trigger element (rendered in place).
 * @param props.items - selectable rows and optional separators.
 * @param props.selectedId - row shown as selected.
 * @param props.selectedIds - rows shown as selected when a menu contains independent option groups.
 * @param props.onSelect - row click callback (not called for disabled rows or submenu parents that only open children).
 * @param props.onClose - invoked on outside click or Escape.
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
 * @param props.returnFocusRef - external trigger when the owner renders the anchor elsewhere.
 * @param props.ariaLabel - menu name when an external trigger cannot label it.
 * @returns anchor wrapper with the conditional list.
 */
export function Menu({ open, anchor, items, selectedId, selectedIds, onSelect, onClose, align = 'start', side = 'bottom', portal = false, closeOnPointerLeave = false, dense = false, compact = false, getAnchorRect, returnFocusRef, ariaLabel, footer, className }: {
  open: boolean
  anchor: ReactNode
  items: readonly MenuEntry[]
  footer?: readonly MenuEntry[]
  selectedId?: string | undefined
  selectedIds?: readonly string[] | undefined
  onSelect: (id: string) => void
  onClose: () => void
  align?: 'start' | 'end'
  side?: 'bottom' | 'top' | 'right'
  portal?: boolean
  closeOnPointerLeave?: boolean
  dense?: boolean
  compact?: boolean
  getAnchorRect?: () => DOMRect | null
  /** External trigger used when `anchor` is rendered by the owner rather than this Menu. */
  returnFocusRef?: RefObject<HTMLElement | null> | undefined
  /** Menu name for an external trigger; inline anchors name the menu through aria-labelledby. */
  ariaLabel?: string | undefined
  className?: string
}) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
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
    onClose()
    queueMicrotask(focusAnchor)
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
    const selectedFrom = document.activeElement
    onSelect(id)
    queueMicrotask(() => {
      if (document.activeElement === selectedFrom || document.activeElement === document.body) focusAnchor()
    })
  }

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!(event.target instanceof Element)) return
    const item = event.target.closest<HTMLButtonElement>('[role="menuitem"]')
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
      && [...typeahead.current].every(character => character === typed)
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
      if (lh > 0) y = Math.min(Math.max(y, MARGIN), vh - lh - MARGIN)

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

  useEffect(() => {
    if (!open) {
      setOpenSubmenuId(null)
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
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

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
    return (
      <div
        key={entry.id}
        className={css.itemWrap}
        onMouseEnter={() => { setOpenSubmenuId(hasSub ? entry.id : null) }}
        onMouseLeave={() => { setOpenSubmenuId(null) }}
      >
        <button
          type="button"
          role="menuitem"
          className={clsx(css.item, selected && css.selected, entry.danger === true && css.danger)}
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
          {selected && <IconCheckOutline16 className={css.check} />}
        </button>
        {subOpen && entry.submenu !== undefined && (
          <div
            id={`${menuId}-submenu-${encodeURIComponent(entry.id)}`}
            className={clsx(css.submenu, compact && css.compactList)}
            role="menu"
            aria-labelledby={`${menuId}-item-${encodeURIComponent(entry.id)}`}
          >
            {entry.submenu.map(sub => (
              <button
                key={sub.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={css.item}
                disabled={sub.disabled}
                onClick={() => { selectItem(sub.id) }}
              >
                {sub.icon !== undefined && <span className={css.itemIcon}>{sub.icon}</span>}
                <span className={css.itemLabel}>{sub.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Portal lists render hidden until placed: the placement effect measures
  // this pre-render in the same commit, so the first painted frame is
  // already at the final position (with getAnchorRect returning null the
  // list simply stays hidden).
  const list = open && (
    <div
      ref={listRef}
      className={clsx(css.list, dense && css.denseList, compact && css.compactList, scrollable && css.scrollable, portal && css.portal, side === 'top' && !portal && css.sideTop, align === 'end' && !portal && css.alignEnd)}
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
      // (open/toggle) after onSelect.
      onClick={(e) => { e.stopPropagation() }}
    >
      <div className={css.viewport} role="presentation">
        {items.map(renderEntry)}
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
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          initialEdge.current = event.key === 'ArrowDown' ? 1 : -1
          if (open) {
            const menu = listRef.current
            if (menu !== null) focusAt(menu, initialEdge.current === 1 ? 0 : menuItems(menu).length - 1)
          } else if (event.currentTarget instanceof HTMLElement) event.currentTarget.click()
        } else if (event.key === 'Escape' && open) {
          event.preventDefault()
          closeAndRestore()
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
