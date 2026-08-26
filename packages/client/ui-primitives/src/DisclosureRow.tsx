import { type MouseEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14 } from './icons/index.tsx'
import css from './DisclosureRow.module.css'

/** Shared 24px disclosure chrome for compact flow rows. */
export interface DisclosureRowProps {
  icon: ReactNode
  title: string
  /** Stable spoken name for the disclosure button; defaults to `title`. */
  accessibleName?: string | undefined
  open: boolean
  expandable: boolean
  onToggle: () => void
  /** Makes the complete title row the disclosure target. */
  expandOnRowClick?: boolean | undefined
  /** Replaces the collapsed icon with a chevron while the row is hovered. */
  previewChevron?: boolean | undefined
  /** Keeps `collapsedContent` inline while open. */
  keepContentWhenOpen?: boolean | undefined
  collapsedContent?: ReactNode
  /** Keep focusable/actionable collapsed content in the accessibility tree. */
  collapsedContentAccessible?: boolean | undefined
  children?: ReactNode
  className?: string | undefined
  rowClassName?: string | undefined
  leadingClassName?: string | undefined
  chevronClassName?: string | undefined
  titleClassName?: string | undefined
}

/**
 * Render one disclosure header and its controlled expanded content.
 * @param props - Visual content, controlled state, and interaction policy.
 * @returns the disclosure row.
 */
export function DisclosureRow({
  icon,
  title,
  accessibleName = title,
  open,
  expandable,
  onToggle,
  expandOnRowClick = false,
  previewChevron = expandable,
  keepContentWhenOpen = false,
  collapsedContent,
  collapsedContentAccessible = false,
  children,
  className,
  rowClassName,
  leadingClassName,
  chevronClassName,
  titleClassName,
}: DisclosureRowProps) {
  const rowExpands = expandable && expandOnRowClick
  const toggleFromLeading = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onToggle()
  }
  const collapsedLeading = previewChevron
    ? (
      <>
        <span className={css.iconIdle}>{icon}</span>
        <IconChevronDownOutline14 className={clsx(chevronClassName, css.chevronHover)} />
      </>
    )
    : icon
  const leading = open
    ? <IconChevronDownOutline14 className={chevronClassName} />
    : collapsedLeading

  return (
    <div className={clsx(css.root, className)} data-open={open || undefined}>
      <div
        className={clsx(css.row, rowClassName)}
        data-disclosure-row
        data-expandable={rowExpands || undefined}
      >
        {rowExpands && (
          // A sibling overlay keeps the whole visual row clickable without
          // wrapping file/action buttons inside another interactive control.
          <button
            type="button"
            className={css.rowToggle}
            aria-label={accessibleName}
            aria-expanded={open}
            onClick={onToggle}
          />
        )}
        {expandable && !rowExpands ? (
          <button
            type="button"
            className={clsx(css.leading, leadingClassName)}
            aria-label={accessibleName}
            aria-expanded={open}
            onClick={toggleFromLeading}
          >
            {leading}
          </button>
        ) : (
          <span className={clsx(css.leading, leadingClassName)} aria-hidden="true">
            {leading}
          </span>
        )}
        <span className={clsx(css.title, titleClassName)} aria-hidden={expandable || undefined}>{title}</span>
        {(keepContentWhenOpen || !open) && (
          <span
            className={css.contentLabel}
            aria-hidden={expandable && !collapsedContentAccessible ? true : undefined}
          >
            {collapsedContent}
          </span>
        )}
      </div>
      {open && children}
    </div>
  )
}
