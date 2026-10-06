import { memo, useId, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutlineRegular, IconChevronUpOutlineRegular } from './icons/index.tsx'
import { TextShimmer } from './TextShimmer.tsx'
import css from './DisclosureRow.module.css'

/** Shared 24px process row: tertiary text and icons, secondary on hover. */
export interface DisclosureRowProps {
  icon: ReactNode
  title: string
  /** Stable accessible name for the disclosure control. Defaults to `title`. */
  accessibleLabel?: string | undefined
  open: boolean
  expandable: boolean
  onToggle: () => void
  /** Animate the complete header while its owning operation is running. */
  running?: boolean | undefined
  /** Makes the complete title row the disclosure target. */
  expandOnRowClick?: boolean | undefined
  /**
   * Declares that `collapsedContent` contains its own interactive control.
   * The row remains a pointer target, while a separate named leading button
   * owns the disclosure semantics so controls never nest in `role="button"`.
   */
  interactiveCollapsedContent?: boolean | undefined
  /** Replaces the collapsed icon with a chevron while the row is hovered. */
  previewChevron?: boolean | undefined
  /** Keeps `collapsedContent` inline while open. */
  keepContentWhenOpen?: boolean | undefined
  collapsedContent?: ReactNode
  children?: ReactNode
  className?: string | undefined
  rowClassName?: string | undefined
  /** Sizing class for the header text area, beside the leading icon. */
  contentClassName?: string | undefined
  /** Layout class shared by the header text and its decorative copy. */
  contentLayoutClassName?: string | undefined
  leadingClassName?: string | undefined
  chevronClassName?: string | undefined
  titleClassName?: string | undefined
}

/**
 * Render one disclosure header and its controlled expanded content.
 * Shallow prop comparison requires stable callbacks and React nodes to skip unchanged renders.
 * @param props - Visual content, controlled state, and interaction policy.
 * @returns the disclosure row.
 */
export const DisclosureRow = memo(function DisclosureRow({
  icon,
  title,
  accessibleLabel,
  open,
  expandable,
  onToggle,
  running = false,
  expandOnRowClick = false,
  interactiveCollapsedContent = false,
  previewChevron = expandable,
  keepContentWhenOpen = false,
  collapsedContent,
  children,
  className,
  rowClassName,
  contentClassName,
  contentLayoutClassName,
  leadingClassName,
  chevronClassName,
  titleClassName,
}: DisclosureRowProps) {
  const contentId = useId()
  const rowExpands = expandable && expandOnRowClick
  const rowOwnsDisclosure = rowExpands && !interactiveCollapsedContent
  const toggleFromLeading = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onToggle()
  }
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!rowOwnsDisclosure || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onToggle()
  }
  const collapsedLeading = previewChevron
    ? (
      <>
        <span className={css.iconIdle}>{icon}</span>
        <IconChevronDownOutlineRegular className={clsx(chevronClassName, css.chevronHover)} />
      </>
    )
    : icon
  const leading = open
    ? <IconChevronUpOutlineRegular className={chevronClassName} />
    : collapsedLeading

  return (
    <div className={clsx(css.root, className)} data-open={open || undefined}>
      <div
        className={clsx(css.row, rowClassName)}
        data-disclosure-row
        data-expandable={rowExpands || undefined}
        role={rowOwnsDisclosure ? 'button' : undefined}
        tabIndex={rowOwnsDisclosure ? 0 : undefined}
        aria-label={rowOwnsDisclosure ? accessibleLabel : undefined}
        aria-expanded={rowOwnsDisclosure ? open : undefined}
        aria-controls={rowOwnsDisclosure ? contentId : undefined}
        onClick={rowExpands ? onToggle : undefined}
        onKeyDown={rowOwnsDisclosure ? toggleFromKeyboard : undefined}
      >
        {expandable && !rowOwnsDisclosure ? (
          <button
            type="button"
            className={clsx(css.leading, leadingClassName)}
            aria-label={accessibleLabel ?? title}
            aria-expanded={open}
            aria-controls={contentId}
            onClick={toggleFromLeading}
          >
            {leading}
          </button>
        ) : (
          <span className={clsx(css.leading, leadingClassName)}>
            {leading}
          </span>
        )}
        <TextShimmer active={running} className={contentClassName} contentClassName={contentLayoutClassName}>
          <TextShimmer className={clsx(css.title, titleClassName)}>{title}</TextShimmer>
          {(keepContentWhenOpen || !open) && collapsedContent}
        </TextShimmer>
      </div>
      {expandable ? (
        <div id={contentId} className={css.content} hidden={!open}>
          {open && children}
        </div>
      ) : open && children}
    </div>
  )
})
