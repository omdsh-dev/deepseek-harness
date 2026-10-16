// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { transferSidebarFocus } from '../src/client/shell/focus.ts'

afterEach(cleanup)

it('moves expansion focus only to the matching session control', async () => {
  const view = render(<>
    <button data-testid="source" data-sidebar-right-session="a">Open</button>
    <button data-sidebar-right-toggle data-sidebar-right-session="b">Other</button>
    <button data-sidebar-right-toggle data-sidebar-right-session="a">Close</button>
  </>)
  const source = view.getByTestId('source')
  source.focus()
  transferSidebarFocus(source, true)
  await Promise.resolve()
  expect(document.activeElement).toBe(view.getByText('Close'))
})

it('restores collapse focus after the source is removed', async () => {
  const view = render(<>
    <button key="source" data-testid="source" data-sidebar-right-session="a">Close</button>
    <button key="target" data-sidebar-right-expand data-sidebar-right-session="a">Open</button>
  </>)
  const source = view.getByTestId('source')
  source.focus()
  transferSidebarFocus(source, false)
  view.rerender(<><button key="target" data-sidebar-right-expand data-sidebar-right-session="a">Open</button></>)
  await Promise.resolve()
  expect(document.activeElement).toBe(view.getByText('Open'))
})

it('does not steal focus from a newer dialog or navigation', async () => {
  const view = render(<>
    <button data-testid="source" data-sidebar-right-session="a">Open</button>
    <button data-sidebar-right-toggle data-sidebar-right-session="a">Close</button>
    <button>New owner</button>
  </>)
  const source = view.getByTestId('source')
  source.focus()
  transferSidebarFocus(source, true)
  view.getByText('New owner').focus()
  await Promise.resolve()
  expect(document.activeElement).toBe(view.getByText('New owner'))
})
