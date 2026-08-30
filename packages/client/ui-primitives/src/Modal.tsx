import { useEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { IconCloseOutline16 } from './icons/index.tsx'
import css from './Modal.module.css'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const dialogStack: HTMLElement[] = []
let inertRoot: { element: HTMLElement; previous: boolean } | null = null

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(element =>
    !element.hidden
    && element.getAttribute('aria-hidden') !== 'true'
    && element.closest('[inert]') === null)
}

function activateDialog(dialog: HTMLElement): () => void {
  if (dialogStack.length === 0) {
    const appRoot = document.getElementById('root')
    if (appRoot !== null) {
      inertRoot = { element: appRoot, previous: appRoot.inert }
      appRoot.inert = true
    }
  }
  dialogStack.push(dialog)
  return () => {
    const index = dialogStack.lastIndexOf(dialog)
    /* v8 ignore else -- every cleanup closes the dialog registered by this activation. */
    if (index >= 0) dialogStack.splice(index, 1)
    if (dialogStack.length !== 0 || inertRoot === null) return
    inertRoot.element.inert = inertRoot.previous
    inertRoot = null
  }
}

interface ModalBaseProps {
  open: boolean
  onClose: () => void
  title: string
  labelledBy?: string
  initialFocusRef?: RefObject<HTMLElement | null> | undefined
  description?: string
  children?: ReactNode
  footer?: ReactNode
  className?: string
  contentClassName?: string
}

type ModalProps = ModalBaseProps & (
  | { headless: true; closeLabel?: never }
  | { headless?: false; closeLabel: string }
)

/**
 * Render a centered, body-portaled modal over a blurred page mask.
 * @param props.open - whether the dialog is showing.
 * @param props.onClose - Escape or mask click.
 * @param props.title - dialog heading (aria-label in every mode).
 * @param props.labelledBy - optional id of a visible heading that replaces the aria-label.
 * @param props.initialFocusRef - optional contained target focused when the dialog opens.
 * @param props.closeLabel - localized accessible close-button label.
 * @param props.description - optional supporting sentence under the title.
 * @param props.children - body (inputs, etc.).
 * @param props.footer - action row (Cancel / Create).
 * @param props.contentClassName - optional class for a scrollable content region.
 * @param props.headless - render children directly in the card (no default
 * header/close/body chrome); mask, card, Escape, and aria-label remain.
 * @returns null when closed; otherwise the overlay tree.
 */
export function Modal({
  open, onClose, title, labelledBy, initialFocusRef, closeLabel, description, children, footer, className,
  contentClassName, headless = false,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const openingInvokerRef = useRef<HTMLElement | null>(null)
  if (!open) openingInvokerRef.current = null
  else if (dialogRef.current === null && openingInvokerRef.current === null
    && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    openingInvokerRef.current = document.activeElement
  }

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    /* v8 ignore next -- open always renders and attaches the dialog before effects run. */
    if (dialog === null) return
    const opener = openingInvokerRef.current
    const deactivate = activateDialog(dialog)
    const requestedInitial = initialFocusRef?.current ?? null
    const explicitInitial = requestedInitial !== null && dialog.contains(requestedInitial)
      ? requestedInitial
      : null
    const current = document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement)
      ? document.activeElement
      : null
    const initial = explicitInitial
      ?? current
      ?? dialog.querySelector<HTMLElement>('[autofocus]')
      ?? focusableElements(dialog)[0]
      ?? dialog
    initial.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (dialogStack.at(-1) !== dialog) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusableElements(dialog)
      const first = items[0]
      const last = items.at(-1)
      if (first === undefined || last === undefined) {
        e.preventDefault()
        dialog.focus()
        return
      }
      const active = document.activeElement
      const activeIndex = items.findIndex(item => item === active)
      if (activeIndex < 0) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
        return
      }
      if (e.shiftKey ? activeIndex === 0 : activeIndex === items.length - 1) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      deactivate()
      if (opener?.isConnected === true) opener.focus()
    }
  }, [initialFocusRef, open])

  if (!open) return null

  return createPortal((
    <div className={css.root} role="presentation">
      <div
        className={css.mask}
        aria-hidden="true"
        onClick={() => {
          const dialog = dialogRef.current
          if (dialog !== null && dialogStack.at(-1) === dialog) onClose()
        }}
      />
      <div
        ref={dialogRef}
        className={clsx(css.dialog, className)}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy === undefined ? title : undefined}
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {headless
          ? children
          : (
            <>
              <div className={clsx(css.content, contentClassName)}>
                <div className={css.header}>
                  <h2 className={css.title}>{title}</h2>
                  <button type="button" className={css.close} aria-label={closeLabel} onClick={onClose}>
                    <IconCloseOutline16 size={14} />
                  </button>
                </div>
                {description !== undefined && description !== '' && (
                  <p className={css.description}>{description}</p>
                )}
                {children !== undefined && <div className={css.body}>{children}</div>}
              </div>
              {footer !== undefined && <div className={css.footer}>{footer}</div>}
            </>
          )}
      </div>
    </div>
  ), document.body)
}
