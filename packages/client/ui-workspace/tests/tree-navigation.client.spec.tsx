/** @vitest-environment jsdom */

import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTreeKeyboardNavigation } from '../src/client/rows/tree-navigation.ts'

type Navigation = ReturnType<typeof useTreeKeyboardNavigation>
let latestNavigation: Navigation

function Harness({ children, show = true }: { children?: ReactNode; show?: boolean }) {
  const navigation = useTreeKeyboardNavigation()
  latestNavigation = navigation
  if (!show) return null
  return <div data-testid="tree" role="tree" {...navigation}>{children}</div>
}

function Row({
  children, expanded, label, level, selected, tabIndex,
}: {
  children?: ReactNode
  expanded?: boolean
  label?: string
  level?: number
  selected?: boolean
  tabIndex?: number
}) {
  return (
    <div
      role="treeitem"
      aria-expanded={expanded}
      aria-level={level}
      aria-selected={selected}
      data-tree-label={label}
      tabIndex={tabIndex}
    >
      {children}
    </div>
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Workspace tree keyboard owner', () => {
  it('chooses selected, existing, first, and focused roving entries', () => {
    const view = render(<Harness show={false} />)
    view.rerender(<Harness />)
    expect(screen.queryByRole('treeitem')).toBeNull()

    const activeElement = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null)
    view.rerender(<Harness><Row label="first" tabIndex={-1} /></Harness>)
    expect(screen.getByRole('treeitem').tabIndex).toBe(0)
    activeElement.mockRestore()

    view.rerender(
      <Harness>
        <Row label="first" tabIndex={-1} />
        <Row label="selected" selected><button type="button">Action</button></Row>
      </Harness>,
    )
    const rows = screen.getAllByRole('treeitem')
    expect(rows.map(row => row.tabIndex)).toEqual([-1, 0])
    expect(screen.getByRole('button', { name: 'Action' }).tabIndex).toBe(0)

    rows[0]!.focus()
    view.rerender(
      <Harness>
        <Row label="first" tabIndex={-1} />
        <Row label="selected" selected><button type="button">Action</button></Row>
      </Harness>,
    )
    expect(screen.getAllByRole('treeitem').map(row => row.tabIndex)).toEqual([0, -1])
  })

  it('owns boundary, disclosure, activation, parent, and typeahead keys', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const parentClick = vi.fn()
    const childClick = vi.fn()
    render(
      <Harness>
        <div
          role="treeitem"
          aria-expanded="false"
          aria-level={1}
          data-tree-label="Alpha"
          onClick={parentClick}
        />
        <div
          role="treeitem"
          aria-level={2}
          data-tree-label="Alpine"
          onClick={childClick}
        />
        <Row label="Atlas" level={1} />
        <Row level={1} />
      </Harness>,
    )
    const rows = screen.getAllByRole('treeitem')
    const [parent, child, atlas, unlabeled] = rows as [HTMLElement, HTMLElement, HTMLElement, HTMLElement]

    parent.focus()
    expect(fireEvent.keyDown(parent, { key: 'ArrowRight' })).toBe(false)
    expect(parentClick).toHaveBeenCalledTimes(1)
    parent.setAttribute('aria-expanded', 'true')
    fireEvent.keyDown(parent, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(child)
    fireEvent.keyDown(child, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(parent)
    fireEvent.keyDown(parent, { key: 'ArrowLeft' })
    expect(parentClick).toHaveBeenCalledTimes(2)

    parent.removeAttribute('aria-level')
    parent.setAttribute('aria-expanded', 'true')
    parent.focus()
    fireEvent.keyDown(parent, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(child)

    atlas.setAttribute('aria-expanded', 'true')
    atlas.setAttribute('aria-level', '0')
    unlabeled.removeAttribute('aria-level')
    atlas.focus()
    fireEvent.keyDown(atlas, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(unlabeled)
    unlabeled.setAttribute('aria-expanded', 'true')
    fireEvent.keyDown(unlabeled, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(unlabeled)

    atlas.removeAttribute('aria-expanded')
    atlas.removeAttribute('aria-level')
    unlabeled.removeAttribute('aria-expanded')
    unlabeled.setAttribute('aria-level', '2')
    fireEvent.keyDown(unlabeled, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(atlas)

    parent.removeAttribute('aria-expanded')
    parent.focus()
    fireEvent.keyDown(parent, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(parent)
    fireEvent.keyDown(parent, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(parent)

    fireEvent.keyDown(parent, { key: 'End' })
    expect(document.activeElement).toBe(unlabeled)
    expect(fireEvent.keyDown(unlabeled, { key: 'ArrowDown' })).toBe(true)
    fireEvent.keyDown(unlabeled, { key: 'Home' })
    expect(document.activeElement).toBe(parent)
    expect(fireEvent.keyDown(parent, { key: 'ArrowUp' })).toBe(true)

    fireEvent.keyDown(parent, { key: 'Enter' })
    fireEvent.keyDown(child, { key: ' ' })
    expect(parentClick).toHaveBeenCalledTimes(3)
    expect(childClick).toHaveBeenCalledTimes(1)
    expect(fireEvent.keyDown(parent, { key: 'k', ctrlKey: true })).toBe(true)

    child.focus()
    fireEvent.keyDown(child, { key: 'a' })
    expect(document.activeElement).toBe(atlas)
    vi.advanceTimersByTime(100)
    fireEvent.keyDown(atlas, { key: 'l' })
    expect(document.activeElement).toBe(parent)
    vi.advanceTimersByTime(600)
    fireEvent.keyDown(parent, { key: 'a' })
    expect(document.activeElement).toBe(child)
    fireEvent.keyDown(child, { key: 'a' })
    expect(document.activeElement).toBe(atlas)
    expect(fireEvent.keyDown(atlas, { key: 'z' })).toBe(true)
  })

  it('ignores child controls and detached targets while pointer and focus promote rows', () => {
    const view = render(
      <Harness>
        <Row label="one"><button type="button">Action</button></Row>
        <Row label="two" />
      </Harness>,
    )
    const [first, second] = screen.getAllByRole('treeitem') as [HTMLElement, HTMLElement]
    const action = screen.getByRole('button', { name: 'Action' })

    fireEvent.pointerDown(action)
    expect(first.tabIndex).toBe(0)
    action.focus()
    expect(first.tabIndex).toBe(0)
    fireEvent.keyDown(action, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(action)
    fireEvent.pointerDown(second)
    expect(document.activeElement).toBe(second)
    expect(second.tabIndex).toBe(0)

    const detached = document.createElement('span')
    const detachedRow = document.createElement('div')
    detachedRow.setAttribute('role', 'treeitem')
    latestNavigation.onFocusCapture({ target: detached } as unknown as Parameters<Navigation['onFocusCapture']>[0])
    latestNavigation.onFocusCapture({ target: detachedRow } as unknown as Parameters<Navigation['onFocusCapture']>[0])
    latestNavigation.onFocusCapture({ target: document } as unknown as Parameters<Navigation['onFocusCapture']>[0])
    latestNavigation.onKeyDown({ target: document } as unknown as Parameters<Navigation['onKeyDown']>[0])
    fireEvent.keyDown(screen.getByTestId('tree'), { key: 'Home' })

    view.rerender(<Harness show={false} />)
    latestNavigation.onFocusCapture({ target: detached } as unknown as Parameters<Navigation['onFocusCapture']>[0])
    latestNavigation.onPointerDownCapture({ target: detached } as unknown as Parameters<Navigation['onPointerDownCapture']>[0])
    latestNavigation.onKeyDown({ target: detached } as unknown as Parameters<Navigation['onKeyDown']>[0])
  })
})
