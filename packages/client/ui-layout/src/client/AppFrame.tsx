/**
 * Three-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * details), the drag handles (pointer capture + rAF throttle), the concession
 * chain (columns.ts), and the child-slot render decisions: the sidebar slot
 * renders HERE with live parameters from the concession solve, and the
 * session-aware occupants render in fixed column positions; strict entries
 * gate themselves on current-session availability while session-maybe
 * entries retain identity. Pure component: everything arrives
 * through the three framework shares — zero cordis or framework imports,
 * zero self-made hooks.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  CENTER_MIN, computeColumns, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_AUTO_COLLAPSE, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'
import { DocumentTitle } from './DocumentTitle.tsx'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'common'>

const SIDEBAR_PANE_ID = 'dsh-sidebar-pane'
const DETAILS_PANE_ID = 'dsh-details-pane'
const RESIZE_STEP = 10

/** Sidebar navigation landmark and grid item. */
function SidebarColumn(props: { label: string; children?: ReactNode }) {
  return <nav id={SIDEBAR_PANE_ID} className={css.sidebarCol} aria-label={props.label}>{props.children}</nav>
}

/** Center-column main landmark (session-body building block). */
function CenterColumn(props: { children?: ReactNode }) {
  return <main className={css.centerCol}>{props.children}</main>
}

/** Details complementary landmark; a zero-width mounted subtree is inert and absent from the accessibility tree. */
function DetailsColumn(props: { label: string; collapsed: boolean; children?: ReactNode }) {
  const paneRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const pane = paneRef.current
    /* v8 ignore next -- the aside is rendered unconditionally with this ref. */
    if (pane === null) return
    pane.inert = props.collapsed
  }, [props.collapsed])
  return (
    <aside
      ref={paneRef}
      id={DETAILS_PANE_ID}
      className={css.detailsCol}
      aria-label={props.label}
      aria-hidden={props.collapsed || undefined}
    >
      {props.children}
    </aside>
  )
}

/**
 * One focusable window splitter: pointer capture with rAF-throttled deltas,
 * plus Arrow, Home, End, and Enter operation over the primary pane's width.
 * `side` keys both the visual direction and which horizontal Arrow grows it.
 */
function DragHandle(props: {
  side: 'sidebar' | 'details'
  left: number
  value: number
  min: number
  resizeMin: number
  max: number
  collapsed: boolean
  disabled?: boolean
  label: string
  valueText: string
  controls: string
  onStart: () => void
  onDrag: (dx: number) => void
  onEnd: () => void
  onSet: (value: number) => void
  onToggle: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || props.collapsed || props.disabled === true) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [props.collapsed, props.disabled])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (props.disabled === true) return
    if (event.key === 'Enter') {
      event.preventDefault()
      props.onToggle()
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      if (!props.collapsed) props.onToggle()
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      props.onSet(props.max)
      return
    }
    const grows = props.side === 'sidebar' ? event.key === 'ArrowRight' : event.key === 'ArrowLeft'
    const shrinks = props.side === 'sidebar' ? event.key === 'ArrowLeft' : event.key === 'ArrowRight'
    if (!grows && !shrinks) return
    event.preventDefault()
    if (props.collapsed) {
      if (grows) props.onSet(props.resizeMin)
      return
    }
    const delta = grows ? RESIZE_STEP : -RESIZE_STEP
    props.onSet(Math.min(props.max, Math.max(props.resizeMin, props.value + delta)))
  }

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      role="separator"
      aria-label={props.label}
      aria-controls={props.controls}
      aria-orientation="vertical"
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={props.value}
      aria-valuetext={props.valueText}
      aria-disabled={props.disabled || undefined}
      aria-hidden={props.disabled || undefined}
      tabIndex={props.disabled === true ? -1 : 0}
      data-side={props.side}
      data-collapsed={props.collapsed || undefined}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
    />
  )
}

/** The three-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  actions,
  renderSlot,
  SessionProvider,
  t,
}: AppFrameProps) {
  const panels = useStore(s => s)
  const detailsSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  const documentTitle = useSessions((s) => {
    const current = s.current
    return current === undefined ? undefined : s.byId[current]?.title
  })
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)

  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) {
      actions.closeDetails()
    }
    lastSession.current = detailsSession
  }, [actions, detailsSession])

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        const width = el.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  // Narrow viewports auto-collapse the sidebar; the store mirror keeps
  // toggleSidebar's semantics right (narrow toggles flip the manual
  // re-expand override, stores.ts). Collapsed is decided here, so the
  // solver stays breakpoint-free: a narrow re-expand passes the preference
  // (or the default when the wide preference is closed) and the center
  // absorbs the squeeze.
  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarPreference = sidebarCollapsed
    ? 0
    : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  const cols = computeColumns(viewport, sidebarPreference, detailsSession === undefined ? 0 : panels.details)
  const colsRef = useRef(cols)
  colsRef.current = cols

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const detailsBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onDetailsStart = useCallback(() => { detailsBase.current = colsRef.current.details; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onDetailsDrag = useCallback((dx: number) => {
    actions.setDetails(detailsBase.current - dx)
  }, [actions])
  const productTitle = process.env.DSH_CLIENT_TITLE ?? t('brand.localBuild')
  const detailsCapacity = viewport - cols.sidebar - CENTER_MIN
  const detailsMaximum = detailsCapacity < DETAILS_MIN ? 0 : Math.min(DETAILS_MAX, detailsCapacity)
  const detailsCollapsed = cols.details === 0
  const setSidebarFromSplitter = useCallback((width: number) => {
    if (sidebarCollapsed) actions.toggleSidebar()
    actions.setSidebar(width)
  }, [actions, sidebarCollapsed])
  const setDetailsFromSplitter = useCallback((width: number) => {
    actions.setDetails(width)
  }, [actions])
  const toggleDetailsFromSplitter = useCallback(() => {
    if (colsRef.current.details === 0) actions.openDetails()
    else actions.closeDetails()
  }, [actions])
  const sidebarLabel = t('layout.sidebar')
  const detailsLabel = t('layout.details')

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{ gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px` }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={cols.details === 0 || undefined}
      data-dragging={dragging || undefined}
    >
      <DocumentTitle
        productTitle={productTitle}
        {...documentTitle === undefined ? {} : { title: documentTitle }}
      />
      <SidebarColumn label={sidebarLabel}>
        {/* Render-site slot call with live concession output: a closed
            sidebar keeps the mounted slot at the compact-rail width, and the
            component sees its rendered state as owner params decided here
            (collapsed follows the resolved rail, so a derived auto-collapse
            renders the rail UI too). */}
        {renderSlot('sidebar', {
          collapsed: sidebarCollapsed,
          width: cols.sidebar,
        })}
      </SidebarColumn>
      <>
        {/* Both column occupants stay at fixed tree positions from first
            paint — no loading gate: a bare status line reads worse than
            the shell's own pending rendering. The conversation
            is session-maybe; SessionProvider withholds the strict details
            entry while no session is current. */}
        <CenterColumn>
          <h1 className={css.visuallyHidden}>{t('layout.application')}</h1>
          {renderSlot('conversation', {})}
        </CenterColumn>
        <DetailsColumn label={detailsLabel} collapsed={detailsCollapsed}>
          <SessionProvider>{renderSlot('details', {})}</SessionProvider>
        </DetailsColumn>
      </>
      <div className={css.overlayLayer} data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
      <DragHandle
        side="sidebar"
        left={cols.sidebar}
        value={cols.sidebar}
        min={SIDEBAR_COLLAPSED}
        resizeMin={SIDEBAR_MIN}
        max={SIDEBAR_MAX}
        collapsed={sidebarCollapsed}
        label={sidebarLabel}
        valueText={sidebarCollapsed ? t('layout.collapsed') : t('layout.widthPixels', { value: cols.sidebar })}
        controls={SIDEBAR_PANE_ID}
        onStart={onSidebarStart}
        onDrag={onSidebarDrag}
        onEnd={onDragEnd}
        onSet={setSidebarFromSplitter}
        onToggle={() => { actions.toggleSidebar() }}
      />
      <DragHandle
        side="details"
        left={viewport - cols.details}
        value={cols.details}
        min={0}
        resizeMin={DETAILS_MIN}
        max={detailsMaximum}
        collapsed={detailsCollapsed}
        disabled={detailsSession === undefined || detailsMaximum === 0}
        label={detailsLabel}
        valueText={detailsCollapsed ? t('layout.collapsed') : t('layout.widthPixels', { value: cols.details })}
        controls={DETAILS_PANE_ID}
        onStart={onDetailsStart}
        onDrag={onDetailsDrag}
        onEnd={onDragEnd}
        onSet={setDetailsFromSplitter}
        onToggle={toggleDetailsFromSplitter}
      />
    </div>
  )
}
