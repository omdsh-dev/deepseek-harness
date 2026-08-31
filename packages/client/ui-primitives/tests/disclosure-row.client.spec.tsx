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
