// @vitest-environment jsdom
import { createRef, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Button, ConnectionBanner, Input, Menu, Modal, moveHorizontalTabFocus, Pill, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { POINTER_GRACE_MS } from '../src/pointer-grace.ts'

afterEach(cleanup)

describe('horizontal tab focus', () => {
  it('leaves unrelated keys to the caller', () => {
    const activate = vi.fn()
    render(
      <div role="tablist">
        <button
          type="button"
          role="tab"
          onKeyDown={(event) => {
            moveHorizontalTabFocus(event, ['only'], 0, activate)
          }}
        >
          Only
        </button>
      </div>,
    )

    expect(fireEvent.keyDown(screen.getByRole('tab'), { key: 'PageDown' })).toBe(true)
    expect(activate).not.toHaveBeenCalled()
  })
})

describe('Button', () => {
  it('renders children, icon, and forwards clicks', () => {
    const onClick = vi.fn()
    render(<Button variant="primary" icon={<svg data-testid="ic" />} onClick={onClick}>Go</Button>)
    const button = screen.getByRole('button', { name: 'Go' })
    expect(screen.getByTestId('ic')).toBeDefined()
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('disabled blocks interaction', () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>No</Button>)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('outline variant renders a bordered cancel-style button', () => {
    render(<Button variant="outline">Cancel</Button>)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined()
  })
})

describe('Pill', () => {
  it('is a span when static, a button when clickable', () => {
    const { rerender } = render(<Pill active>tab</Pill>)
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<Pill onClick={() => {}}>tab</Pill>)
    expect(screen.getByRole('button', { name: 'tab' })).toBeDefined()
  })

  it('active and className land on both static and interactive forms', () => {
    const { container, rerender } = render(<Pill className="x">tab</Pill>)
    const asSpan = container.firstElementChild as HTMLElement
    expect(asSpan.classList.contains('x')).toBe(true)
    rerender(<Pill active className="x" onClick={() => {}}>tab</Pill>)
    const asButton = screen.getByRole('button')
    expect(asButton.classList.contains('x')).toBe(true)
  })
})

describe('Input', () => {
  it('forwards value/onChange and renders the leading icon', () => {
    const onChange = vi.fn()
    render(<Input icon={<svg data-testid="ic" />} value="q" onChange={onChange} placeholder="search" />)
    const input = screen.getByPlaceholderText<HTMLInputElement>('search')
    expect(input.value).toBe('q')
    fireEvent.change(input, { target: { value: 'qq' } })
    expect(onChange).toHaveBeenCalled()
    expect(screen.getByTestId('ic')).toBeDefined()
  })
})

describe('Menu', () => {
  const items = [
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Beta', disabled: true },
  ]

  it('shows items only while open; select fires onSelect', () => {
    const onSelect = vi.fn()
    const { rerender } = render(
      <Menu open={false} anchor={<span>trigger</span>} items={items} onSelect={onSelect} onClose={() => {}} />)
    expect(screen.queryByRole('menu')).toBeNull()
    rerender(
      <Menu open anchor={<span>trigger</span>} items={items} selectedId="a" onSelect={onSelect} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Alpha' }))
    expect(onSelect).toHaveBeenCalledWith('a')
  })

  it('disabled item does not select; Escape and outside pointerdown close', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(
      <Menu open anchor={<span>trigger</span>} items={items} onSelect={onSelect} onClose={onClose} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Beta' }))
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('implements menu-button focus entry, roving arrow keys, typeahead, Tab exit, and Escape restoration', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <Menu
            open={open}
            anchor={<button type="button" onClick={() => { setOpen(value => !value) }}>Choose</button>}
            items={[
              { id: 'a', label: 'Alpha' },
              { id: 'b', label: 'Beta', disabled: true },
              { id: 'g', label: 'Gamma' },
            ]}
            onSelect={() => { setOpen(false) }}
            onClose={() => { setOpen(false) }}
          />
          <button type="button">After</button>
        </>
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Choose' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await act(async () => {
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await Promise.resolve()
    })
    const alpha = screen.getByRole('menuitem', { name: 'Alpha' })
    const gamma = screen.getByRole('menuitem', { name: 'Gamma' })
    expect(trigger.getAttribute('aria-controls')).toBe(screen.getByRole('menu').id)
    expect(document.activeElement).toBe(alpha)
    expect(alpha.tabIndex).toBe(-1)
    fireEvent.keyDown(alpha, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(gamma)
    fireEvent.keyDown(gamma, { key: 'Home' })
    expect(document.activeElement).toBe(alpha)
    fireEvent.keyDown(alpha, { key: 'g' })
    expect(document.activeElement).toBe(gamma)
    await act(async () => {
      fireEvent.keyDown(gamma, { key: 'Escape' })
      await Promise.resolve()
    })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    await act(async () => {
      fireEvent.click(trigger)
      await Promise.resolve()
    })
    const reopenedAlpha = screen.getByRole('menuitem', { name: 'Alpha' })
    await act(async () => {
      fireEvent.keyDown(reopenedAlpha, { key: 'Tab' })
      await Promise.resolve()
    })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After' }))
  })

  it('preserves the menu-button contract through a Tooltip anchor', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <Menu
          open={open}
          anchor={(
            <Tooltip label="Choose an item">
              <button type="button" onClick={() => { setOpen(value => !value) }}>Choose</button>
            </Tooltip>
          )}
          items={items}
          onSelect={() => { setOpen(false) }}
          onClose={() => { setOpen(false) }}
        />
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Choose' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    await act(async () => {
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      await Promise.resolve()
    })
    expect(trigger.getAttribute('aria-controls')).toBe(screen.getByRole('menu').id)
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Alpha' }))
  })

  it('inside pointerdown does not close', () => {
    const onClose = vi.fn()
    render(
      <Menu open anchor={<span>trigger</span>} items={items} onSelect={() => {}} onClose={onClose} />)
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Alpha' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('selected item shows the trailing check; align=end, side=top, and className apply', () => {
    const { container } = render(
      <Menu
        open
        align="end"
        side="top"
        className="x"
        anchor={<span>trigger</span>}
        items={items}
        selectedId="a"
        onSelect={() => {}}
        onClose={() => {}}
      />)
    expect((container.firstElementChild as HTMLElement).classList.contains('x')).toBe(true)
    const menu = screen.getByRole('menu')
    expect(menu.className).toMatch(/sideTop|alignEnd/)
    const selected = screen.getByRole('menuitem', { name: 'Alpha' })
    expect(selected.querySelector('svg')).not.toBeNull()
    const other = screen.getByRole('menuitem', { name: 'Beta' })
    expect(other.querySelector('svg')).toBeNull()
    fireEvent.keyDown(document, { key: 'a' })
  })

  it('renders a leading icon and a separator between groups', () => {
    render(
      <Menu
        open
        compact
        anchor={<span>trigger</span>}
        items={[
          { id: 'a', label: 'Alpha', icon: <svg data-testid="ic" /> },
          { type: 'separator', id: 's1' },
          { id: 'c', label: 'Create' },
        ]}
        onSelect={() => {}}
        onClose={() => {}}
      />)
    expect(screen.getByTestId('ic')).toBeDefined()
    expect(screen.getByRole('separator')).toBeDefined()
  })

  it('renders a non-interactive heading label and a danger row', () => {
    const onSelect = vi.fn()
    render(
      <Menu
        open
        anchor={<span>trigger</span>}
        items={[
          { type: 'label', id: 'h', text: 'Group by' },
          { id: 'del', label: 'Delete', danger: true },
        ]}
        onSelect={onSelect}
        onClose={() => {}}
      />)
    const heading = screen.getByText('Group by')
    expect(heading.getAttribute('role')).toBe('presentation')
    // The heading is not a menu item — only the danger row is interactive.
    expect(screen.getAllByRole('menuitem')).toHaveLength(1)
    const danger = screen.getByRole('menuitem', { name: 'Delete' })
    expect(danger.className).toMatch(/danger/)
    fireEvent.click(danger)
    expect(onSelect).toHaveBeenCalledWith('del')
  })

  it('closeOnPointerLeave closes a grace after the pointer leaves trigger and list; default never does', () => {
    vi.useFakeTimers()
    try {
      const onClose = vi.fn()
      const { rerender } = render(
        <Menu open closeOnPointerLeave anchor={<span>trigger</span>} items={items} onSelect={() => {}} onClose={onClose} />)
      const wrapper = screen.getByText('trigger').parentElement as HTMLElement
      fireEvent.pointerLeave(wrapper)
      // Still open through the grace: the pointer may be crossing the gap.
      act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS - 1) })
      expect(onClose).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(1) })
      expect(onClose).toHaveBeenCalledTimes(1)
      rerender(
        <Menu open anchor={<span>trigger</span>} items={items} onSelect={() => {}} onClose={onClose} />)
      fireEvent.pointerLeave(wrapper)
      act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS * 10) })
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('coming back inside the grace keeps the list open (trigger and list are one region)', () => {
    vi.useFakeTimers()
    try {
      const onClose = vi.fn()
      render(
        <Menu open closeOnPointerLeave anchor={<span>trigger</span>} items={items} onSelect={() => {}} onClose={onClose} />)
      const wrapper = screen.getByText('trigger').parentElement as HTMLElement
      fireEvent.pointerLeave(wrapper)
      act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS - 50) })
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS * 10) })
      expect(onClose).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a close from selection disarms the pending grace close', () => {
    vi.useFakeTimers()
    try {
      const onClose = vi.fn()
      const { rerender } = render(
        <Menu open closeOnPointerLeave anchor={<span>trigger</span>} items={items} onSelect={() => {}} onClose={onClose} />)
      const wrapper = screen.getByText('trigger').parentElement as HTMLElement
      fireEvent.pointerLeave(wrapper)
      // The owner closes for its own reason (selection/Escape) mid-grace; the
      // armed timer must not survive to shut a list reopened right after.
      rerender(
        <Menu open={false} closeOnPointerLeave anchor={<span>trigger</span>} items={items} onSelect={() => {}} onClose={onClose} />)
      act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS * 10) })
      expect(onClose).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaving a closed list arms nothing', () => {
    vi.useFakeTimers()
    try {
      const onClose = vi.fn()
      render(
        <Menu open={false} closeOnPointerLeave anchor={<span>trigger</span>} items={items} onSelect={() => {}} onClose={onClose} />)
      fireEvent.pointerLeave(screen.getByText('trigger').parentElement as HTMLElement)
      act(() => { vi.advanceTimersByTime(POINTER_GRACE_MS * 10) })
      expect(onClose).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a list click does not bubble to the anchor row (portal synthetic-event path)', () => {
    const rowClick = vi.fn()
    render(
      <div onClick={rowClick}>
        <Menu open anchor={<span>trigger</span>} items={items} onSelect={() => {}} onClose={() => {}} />
      </div>)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Alpha' }))
    expect(rowClick).not.toHaveBeenCalled()
  })

  it('opens a submenu on hover and selects a nested item', () => {
    const onSelect = vi.fn()
    render(
      <Menu
        open
        compact
        anchor={<span>trigger</span>}
        items={[
          { id: 'plain', label: 'Plain' },
          {
            id: 'new',
            label: 'New Workspace',
            submenu: [
              { id: 'ok', label: 'Create ok', icon: <svg data-testid="sub-ic" /> },
            ],
          },
        ]}
        onSelect={onSelect}
        onClose={() => {}}
      />)
    const plain = screen.getByRole('menuitem', { name: 'Plain' })
    fireEvent.mouseEnter(plain.parentElement as HTMLElement)
    fireEvent.focus(plain)
    const parent = screen.getByRole('menuitem', { name: 'New Workspace' })
    const wrap = parent.parentElement as HTMLElement
    fireEvent.click(parent)
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.focus(parent)
    fireEvent.mouseEnter(wrap)
    expect(screen.getByTestId('sub-ic')).toBeDefined()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create ok' }))
    expect(onSelect).toHaveBeenCalledWith('ok')
    fireEvent.mouseLeave(wrap)
    expect(screen.queryByRole('menuitem', { name: 'Create ok' })).toBeNull()
  })

  it('enters and leaves a submenu with ArrowRight and ArrowLeft', async () => {
    render(
      <Menu
        open
        anchor={<button type="button">trigger</button>}
        items={[
          { id: 'plain', label: 'Plain' },
          { id: 'parent', label: 'Parent', submenu: [{ id: 'child', label: 'Child' }] },
        ]}
        onSelect={() => {}}
        onClose={() => {}}
      />)
    const parent = screen.getByRole('menuitem', { name: 'Parent' })
    parent.focus()
    await act(async () => {
      fireEvent.keyDown(parent, { key: 'ArrowRight' })
      await Promise.resolve()
    })
    const child = screen.getByRole('menuitem', { name: 'Child' })
    expect(document.activeElement).toBe(child)
    await act(async () => {
      fireEvent.keyDown(child, { key: 'ArrowLeft' })
      await Promise.resolve()
    })
    expect(screen.queryByRole('menuitem', { name: 'Child' })).toBeNull()
    expect(document.activeElement).toBe(parent)
  })

  it('portal mode prefers getAnchorRect over measuring its own wrapper', () => {
    const rect = { left: 40, right: 72, top: 100, bottom: 128, width: 32, height: 28, x: 40, y: 100, toJSON: () => ({}) } as DOMRect
    render(
      <Menu
        portal
        open
        getAnchorRect={() => rect}
        anchor={null}
        items={items}
        onSelect={() => {}}
        onClose={() => {}}
      />)
    const menu = screen.getByRole('menu')
    // side=bottom, align=start: below the host-supplied rect, left-aligned.
    expect(menu.style.left).toBe('40px')
    expect(menu.style.top).toBe('132px')
  })

  it('portal mode skips the frame when getAnchorRect returns null (no menu until a rect exists)', () => {
    render(
      <Menu
        portal
        open
        getAnchorRect={() => null}
        anchor={null}
        items={items}
        onSelect={() => {}}
        onClose={() => {}}
      />)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('portal mode renders the list under body, positions it fixed, and still closes on outside pointerdown', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const { container } = render(
      <Menu portal open anchor={<span>trigger</span>} items={items} onSelect={onSelect} onClose={onClose} />)
    const menu = screen.getByRole('menu')
    // Outside the anchor wrapper subtree — overflow-clipping ancestors can't crop it.
    expect(container.contains(menu)).toBe(false)
    expect(menu.parentElement).toBe(document.body)
    expect(menu.style.top).not.toBe('')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Alpha' }))
    expect(onSelect).toHaveBeenCalledWith('a')
    fireEvent.pointerDown(menu)
    expect(onClose).not.toHaveBeenCalled()
    // Non-Node targets (e.g. window itself) are ignored, not treated as outside.
    const nonNodeTarget = new Event('pointerdown', { bubbles: true })
    Object.defineProperty(nonNodeTarget, 'target', { value: window })
    document.dispatchEvent(nonNodeTarget)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('portal mode resolves align=end / side=top to clamped left/top coordinates', () => {
    render(
      <Menu portal open align="end" side="top" anchor={<span>trigger</span>} items={items} onSelect={() => {}} onClose={() => {}} />)
    const menu = screen.getByRole('menu')
    expect(menu.style.left).not.toBe('')
    expect(menu.style.top).not.toBe('')
    expect(menu.style.right).toBe('')
    expect(menu.style.bottom).toBe('')
  })

  it('renders footer rows in a pinned section below the items; they still select', () => {
    const onSelect = vi.fn()
    render(
      <Menu
        open
        anchor={<span>trigger</span>}
        items={items}
        footer={[{ id: 'new', label: 'Create new' }]}
        onSelect={onSelect}
        onClose={() => {}}
      />)
    const footerItem = screen.getByRole('menuitem', { name: 'Create new' })
    expect((footerItem.closest('div[class*="footer"]'))).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Alpha' }).closest('div[class*="footer"]')).toBeNull()
    fireEvent.click(footerItem)
    expect(onSelect).toHaveBeenCalledWith('new')
  })

  it('caps the list height for internal scrolling unless a submenu row is present', () => {
    const { rerender } = render(
      <Menu open anchor={<span>trigger</span>} items={items} onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('menu').className).toMatch(/scrollable/)
    rerender(
      <Menu
        open
        anchor={<span>trigger</span>}
        items={[{ id: 'p', label: 'Parent', submenu: [{ id: 's', label: 'Sub' }] }]}
        onSelect={() => {}}
        onClose={() => {}}
      />)
    expect(screen.getByRole('menu').className).not.toMatch(/scrollable/)
  })
})

describe('Modal', () => {
  it('is absent while closed; Escape and mask click call onClose', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Modal open={false} onClose={onClose} title="Create new workspace" closeLabel="Close">body</Modal>)
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(
      <Modal open onClose={onClose} title="Create new workspace" closeLabel="Configure later" description="Name it." contentClassName="scrolling-content" footer={<button type="button">Create</button>}>
        <input aria-label="name" />
      </Modal>)
    const dialog = screen.getByRole('dialog', { name: 'Create new workspace' })
    expect(dialog).toBeDefined()
    // The full-page layer escapes caller stacking contexts but remains in
    // this document/current WebUI window.
    expect(dialog.parentElement?.parentElement).toBe(document.body)
    expect(screen.getByRole('button', { name: 'Configure later' })).toBeDefined()
    expect(screen.getByText('Name it.')).toBeDefined()
    expect(screen.getByText('Name it.').parentElement?.className).toContain('scrolling-content')
    fireEvent.keyDown(document, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    // Mask is the presentation sibling behind the dialog.
    const mask = document.querySelector('[aria-hidden="true"]') as HTMLElement
    fireEvent.click(mask)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('renders headless content without the default close chrome', () => {
    render(
      <Modal open onClose={() => {}} title="Custom surface" labelledBy="custom-title" headless>
        <h2 id="custom-title">Custom body</h2>
      </Modal>,
    )
    expect(screen.getByRole('dialog', { name: 'Custom body' })).toBeDefined()
    expect(screen.getByText('Custom body')).toBeDefined()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('contains focus, makes the app inert, and restores the opening control', () => {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    const opener = document.createElement('button')
    appRoot.append(opener)
    document.body.append(appRoot)
    opener.focus()

    const { rerender } = render(
      <Modal open onClose={() => {}} title="Focusable dialog" closeLabel="Close">
        <input autoFocus aria-label="First" />
        <button type="button">Last</button>
      </Modal>,
    )
    const first = screen.getByRole('textbox', { name: 'First' })
    const last = screen.getByRole('button', { name: 'Last' })
    const dialogFirst = screen.getByRole('button', { name: 'Close' })
    expect(appRoot.inert).toBe(true)
    expect(document.activeElement).toBe(first)

    dialogFirst.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(dialogFirst)

    first.focus()
    expect(fireEvent.keyDown(document, { key: 'Tab' })).toBe(true)
    expect(document.activeElement).toBe(first)
    opener.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(dialogFirst)
    opener.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)

    rerender(<Modal open={false} onClose={() => {}} title="Focusable dialog" closeLabel="Close" />)
    expect(appRoot.inert).not.toBe(true)
    expect(document.activeElement).toBe(opener)
    appRoot.remove()
  })

  it('honors only a contained initial-focus target and routes Tab from a non-tabbable target', () => {
    const titleRef = createRef<HTMLHeadingElement>()
    const outside = document.createElement('button')
    document.body.append(outside)
    const { rerender } = render(
      <Modal open onClose={() => {}} title="Guided dialog" headless initialFocusRef={titleRef}>
        <h2 ref={titleRef} tabIndex={-1}>Guided dialog</h2>
        <input autoFocus aria-label="First field" />
        <button type="button">Last action</button>
      </Modal>,
    )
    const title = screen.getByRole('heading', { name: 'Guided dialog' })
    const first = screen.getByRole('textbox', { name: 'First field' })
    const last = screen.getByRole('button', { name: 'Last action' })
    expect(document.activeElement).toBe(title)

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    title.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)

    rerender(<Modal open={false} onClose={() => {}} title="Guided dialog" headless />)
    outside.focus()
    rerender(
      <Modal open onClose={() => {}} title="Bounded dialog" headless initialFocusRef={{ current: outside }}>
        <input autoFocus aria-label="Inside field" />
      </Modal>,
    )
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Inside field' }))
    outside.remove()
  })

  it('does not try to restore a removed opening control', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { rerender } = render(
      <Modal open onClose={() => {}} title="Detached opener" closeLabel="Close">
        <button type="button">Action</button>
      </Modal>,
    )
    opener.remove()
    expect(() => {
      rerender(<Modal open={false} onClose={() => {}} title="Detached opener" closeLabel="Close" />)
    }).not.toThrow()
    expect(document.activeElement).not.toBe(opener)
  })

  it('keeps focus on the dialog when it has no tabbable descendants', () => {
    render(
      <Modal open onClose={() => {}} title="Empty dialog" headless>
        <span>Nothing actionable</span>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Empty dialog' })
    expect(document.activeElement).toBe(dialog)

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(dialog)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(dialog)
  })

  it('lets only the topmost nested dialog handle Escape and mask clicks', () => {
    const closeOuter = vi.fn()
    const closeInner = vi.fn()
    render(
      <>
        <Modal open onClose={closeOuter} title="Outer" closeLabel="Close outer">
          <button type="button">Outer action</button>
        </Modal>
        <Modal open onClose={closeInner} title="Inner" closeLabel="Close inner">
          <button type="button">Inner action</button>
        </Modal>
      </>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeInner).toHaveBeenCalledTimes(1)
    expect(closeOuter).not.toHaveBeenCalled()

    const masks = document.querySelectorAll<HTMLElement>('[aria-hidden="true"]')
    fireEvent.click(masks[0]!)
    expect(closeOuter).not.toHaveBeenCalled()
    fireEvent.click(masks[1]!)
    expect(closeInner).toHaveBeenCalledTimes(2)
  })

  it('makes a covered dialog inert and restores it when the nested dialog closes', () => {
    function NestedDialogs() {
      const [innerOpen, setInnerOpen] = useState(false)
      return (
        <Modal open onClose={() => {}} title="Outer flow" headless>
          <button type="button" onClick={() => { setInnerOpen(true) }}>Open inner</button>
          <Modal open={innerOpen} onClose={() => { setInnerOpen(false) }} title="Inner flow" headless>
            <button type="button" autoFocus>Inner action</button>
          </Modal>
        </Modal>
      )
    }

    render(<NestedDialogs />)
    const opener = screen.getByRole('button', { name: 'Open inner' })
    const outer = screen.getByRole('dialog', { name: 'Outer flow' })
    expect(outer.inert).not.toBe(true)
    fireEvent.click(opener)

    const inner = screen.getByRole('dialog', { name: 'Inner flow' })
    expect(screen.getByRole('dialog', { name: 'Outer flow', hidden: true })).toBe(outer)
    expect(outer.inert).toBe(true)
    expect(inner.inert).not.toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Inner action' }))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Inner flow' })).toBeNull()
    expect(outer.inert).not.toBe(true)
    expect(document.activeElement).toBe(opener)
  })
})

describe('ConnectionBanner', () => {
  it('renders only while reconnecting', () => {
    const { container, rerender } = render(<ConnectionBanner reconnecting={false} label="Reconnecting" />)
    expect(container.firstChild).toBeNull()
    rerender(<ConnectionBanner reconnecting label="Reconnecting" />)
    expect(container.textContent).toContain('Reconnecting')
  })
})
