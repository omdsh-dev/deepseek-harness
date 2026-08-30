// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { MouseEvent } from 'react'
import { DisclosureRow } from '../src/DisclosureRow.tsx'

afterEach(() => {
  cleanup()
})

describe('DisclosureRow accessibility', () => {
  it('uses one named row-wide disclosure for passive collapsed content', () => {
    const onToggle = vi.fn()
    const view = render(
      <DisclosureRow
        icon={<span>icon</span>}
        title="Read"
        accessibleLabel="Read src/a.ts"
        open={false}
        expandable
        expandOnRowClick
        onToggle={onToggle}
        collapsedContent={<span>src/a.ts</span>}
      />,
    )

    const disclosure = view.getByRole('button', { name: 'Read src/a.ts' })
    expect(disclosure.tagName).toBe('DIV')
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(view.container.querySelector('[role="button"] button')).toBeNull()
    fireEvent.keyDown(disclosure, { key: 'Enter' })
    fireEvent.keyDown(disclosure, { key: ' ' })
    fireEvent.keyDown(disclosure, { key: 'Escape' })
    expect(onToggle).toHaveBeenCalledTimes(2)
  })

  it('separates a named leading disclosure from interactive collapsed content', () => {
    const onToggle = vi.fn()
    const openFile = vi.fn((event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
    })
    const view = render(
      <DisclosureRow
        icon={<span>icon</span>}
        title="Read"
        accessibleLabel="Read src/a.ts"
        open={false}
        expandable
        expandOnRowClick
        interactiveCollapsedContent
        onToggle={onToggle}
        collapsedContent={(
          <button type="button" aria-label="Open file src/a.ts" onClick={openFile}>src/a.ts</button>
        )}
      />,
    )

    const row = view.container.querySelector('[data-disclosure-row]')
    const disclosure = view.getByRole('button', { name: 'Read src/a.ts' })
    const fileButton = view.getByRole('button', { name: 'Open file src/a.ts' })
    expect(row?.getAttribute('role')).toBeNull()
    expect(row?.getAttribute('tabindex')).toBeNull()
    expect(row?.getAttribute('aria-expanded')).toBeNull()
    expect(disclosure.tagName).toBe('BUTTON')
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(view.container.querySelector('[role="button"] button')).toBeNull()

    fireEvent.click(fileButton)
    expect(openFile).toHaveBeenCalledTimes(1)
    expect(onToggle).not.toHaveBeenCalled()
    fireEvent.click(disclosure)
    expect(onToggle).toHaveBeenCalledTimes(1)
    fireEvent.click(row as HTMLElement)
    expect(onToggle).toHaveBeenCalledTimes(2)
  })
})
