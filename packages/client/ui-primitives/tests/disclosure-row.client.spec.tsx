// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { DisclosureRow } from '../src/DisclosureRow.tsx'

afterEach(cleanup)

describe('DisclosureRow accessibility', () => {
  it('keeps a stable controlled panel for a whole-row disclosure', () => {
    const toggle = vi.fn()
    const view = render(
      <DisclosureRow
        icon={<span>i</span>}
        title="Details"
        open={false}
        expandable
        expandOnRowClick
        onToggle={toggle}
      >
        <p>Body</p>
      </DisclosureRow>,
    )
    const control = view.getByRole('button', { name: 'iDetails' })
    const panelId = control.getAttribute('aria-controls')
    expect(panelId).not.toBeNull()
    expect(document.getElementById(panelId as string)?.hidden).toBe(true)
    expect(view.queryByText('Body')).toBeNull()
    fireEvent.keyDown(control, { key: 'Enter' })
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('wires a leading-button disclosure to the same stable panel', () => {
    const toggle = vi.fn()
    const view = render(
      <DisclosureRow
        icon={<span>i</span>}
        title="Details"
        open
        expandable
        onToggle={toggle}
      >
        <p>Body</p>
      </DisclosureRow>,
    )
    const control = view.getByRole('button')
    const panelId = control.getAttribute('aria-controls')
    expect(panelId).not.toBeNull()
    expect(document.getElementById(panelId as string)?.hidden).toBe(false)
    expect(view.getByText('Body')).toBeTruthy()
    fireEvent.click(control)
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('separates a named leading disclosure from interactive collapsed content', () => {
    const toggle = vi.fn()
    const openFile = vi.fn()
    const view = render(
      <DisclosureRow
        icon={<span>i</span>}
        title="Read"
        accessibleLabel="Read src/a.ts"
        open={false}
        expandable
        expandOnRowClick
        interactiveCollapsedContent
        onToggle={toggle}
        collapsedContent={(
          <button
            type="button"
            aria-label="Open file src/a.ts"
            onClick={(event) => {
              event.stopPropagation()
              openFile()
            }}
          >
            src/a.ts
          </button>
        )}
      >
        <p>Body</p>
      </DisclosureRow>,
    )

    const row = view.container.querySelector('[data-disclosure-row]')
    const disclosure = view.getByRole('button', { name: 'Read src/a.ts' })
    const fileButton = view.getByRole('button', { name: 'Open file src/a.ts' })
    const panelId = disclosure.getAttribute('aria-controls')
    expect(row?.getAttribute('role')).toBeNull()
    expect(row?.getAttribute('tabindex')).toBeNull()
    expect(row?.getAttribute('aria-expanded')).toBeNull()
    expect(disclosure.tagName).toBe('BUTTON')
    expect(document.getElementById(panelId as string)?.hidden).toBe(true)
    expect(view.container.querySelector('[role="button"] button')).toBeNull()

    fireEvent.click(fileButton)
    expect(openFile).toHaveBeenCalledTimes(1)
    expect(toggle).not.toHaveBeenCalled()
    fireEvent.click(disclosure)
    expect(toggle).toHaveBeenCalledTimes(1)
    fireEvent.click(row as HTMLElement)
    expect(toggle).toHaveBeenCalledTimes(2)
  })

  it('leaves passive rows out of the disclosure control model', () => {
    const view = render(
      <DisclosureRow
        icon={<span>i</span>}
        title="Details"
        open={false}
        expandable={false}
        onToggle={vi.fn()}
      />,
    )
    expect(view.queryByRole('button')).toBeNull()
    expect(view.container.querySelector('[aria-controls]')).toBeNull()
  })
})
