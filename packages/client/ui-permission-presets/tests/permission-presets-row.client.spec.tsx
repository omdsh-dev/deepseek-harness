// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import { PermissionRow, type PermissionRowProps } from '../src/client/PermissionRow.tsx'
import { zh } from '../src/client/locales.ts'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { PermissionPresetSettingsController } from '../src/client/settings-store.ts'

const schema = new SettingsSchemaService(new Context())

/** Controller over a real mirror derived from the same scripted context. */
function derivedController(remote: { settings: object }) {
  const ctx = { remote } as never
  return new PermissionPresetSettingsController(new SettingsDescribeMirror(ctx), ctx, schema)
}

afterEach(cleanup)

const SCHEMA = {
  uid: 5,
  refs: {
    1: { type: 'const', value: 'read-only' },
    2: { type: 'const', value: 'workspace-write' },
    3: { type: 'const', value: 'danger-full-access' },
    4: { type: 'union', list: [1, 2, 3] },
    5: { type: 'object', dict: { defaultPreset: 4 } },
  },
}

function view(defaultPreset: string, revision = 0): SettingsNamespaceView {
  return {
    ns: 'permission',
    schema: SCHEMA,
    value: { defaultPreset },
    base: { defaultPreset: 'read-only' },
    applies: 'live',
    secrets: [],
    revision,
  }
}

/** The settings namespace answers over the Remote carrier, which has no envelope. */
function ok<T>(value: T) {
  return { ok: true as const, value }
}

const dictionary: Record<string, string> = zh
const t: PermissionRowProps['t'] = key => dictionary[key] ?? key
type AttentionSnapshot = Parameters<Parameters<PermissionRowProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: PermissionRowProps['useSessionPendingInteraction'] = selector => selector(noAttention)
const runtime = {
  useSessions: (() => { throw new Error('unused') }) as never,
  useSessionPendingInteraction,
  useWorkspaces: (() => { throw new Error('unused') }) as never,
}

function mount(controller: PermissionPresetSettingsController) {
  return render(
    <PermissionRow
      {...runtime}
      load={() => controller.load()}
      select={preset => controller.select(preset)}
      usePermission={bindSnapshotSelector(controller.store)}
      t={t}
    />,
  )
}

describe('PermissionRow', () => {
  it('loads the descriptor, opens the menu, and selects a new default', async () => {
    const mutate = vi.fn(() => Promise.resolve(ok(view('workspace-write', 1))))
    const controller = derivedController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] })),
        mutate,
      },
    })
    mount(controller)
    const button = await screen.findByRole('button', { name: '仅可查看' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => { expect(button.getAttribute('aria-expanded')).toBe('false') })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('menuitemradio', { name: '仅可查看' }))
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('menuitemradio', { name: '可写入工作区' }))
    await screen.findByRole('button', { name: '可写入工作区' })
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('requires explicit acknowledgement before saving full access', async () => {
    const mutate = vi.fn(() => Promise.resolve(ok(view('danger-full-access', 1))))
    const controller = derivedController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] })),
        mutate,
      },
    })
    mount(controller)
    const selector = await screen.findByRole('button', { name: '仅可查看' })
    fireEvent.click(selector)
    fireEvent.click(screen.getByRole('menuitemradio', { name: '完全权限' }))
    expect(mutate).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: '我已了解风险，并愿意继续' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '确认启用完全权限？' })).toBeNull()
    expect(document.activeElement).toBe(selector)
    fireEvent.click(selector)
    fireEvent.click(screen.getByRole('menuitemradio', { name: '完全权限' }))
    const dialog = screen.getByRole('dialog', { name: '确认启用完全权限？' })
    const enable = screen.getByRole('button', { name: '启用完全权限' })
    expect((enable as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(enable)
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(dialog.isConnected).toBe(false)
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole('button', { name: '完全权限' })) })
  })

  it('hides an unavailable namespace and disables a read-only provider', async () => {
    const absent = derivedController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [] })),
        mutate: vi.fn(),
      },
    })
    const rendered = mount(absent)
    await waitFor(() => { expect(rendered.container.textContent).toBe('') })
    rendered.unmount()

    const readonly = derivedController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: false, hasDocument: false, namespaces: [view('read-only')] })),
        mutate: vi.fn(),
      },
    })
    mount(readonly)
    expect((await screen.findByRole('button', { name: '仅可查看' })).hasAttribute('disabled')).toBe(true)
  })

  it('shows loading and a contained write error', async () => {
    const describe = Promise.withResolvers<ReturnType<typeof ok<{
      writable: boolean
      namespaces: SettingsNamespaceView[]
    }>>>()
    const controller = derivedController({
      settings: {
        describe: () => describe.promise,
        mutate: () => Promise.resolve({
          ok: false as const,
          error: new RemoteError('settings/conflict', 'changed elsewhere', {
            ns: 'permission', expected: 1, actual: 2,
          }),
        }),
      },
    })
    mount(controller)
    expect((await screen.findByRole('button', { name: '加载中' })).hasAttribute('disabled')).toBe(true)
    describe.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] }))
    const button = await screen.findByRole('button', { name: '仅可查看' })
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('menuitemradio', { name: '可写入工作区' }))
    expect((await screen.findByRole('alert')).textContent).toBe('changed elsewhere')
  })

  it('drops deferred focus restoration when the settings owner becomes unavailable', async () => {
    const mutation = Promise.withResolvers<ReturnType<typeof ok<SettingsNamespaceView>>>()
    const controller = derivedController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] })),
        mutate: () => mutation.promise,
      },
    })
    const rendered = mount(controller)
    fireEvent.click(await screen.findByRole('button', { name: '仅可查看' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '可写入工作区' }))
    act(() => {
      controller.store.update((state) => {
        state.status = 'unavailable'
        state.writable = false
      })
    })
    expect(rendered.container.textContent).toBe('')
    await act(async () => {
      mutation.resolve(ok(view('workspace-write', 1)))
      await mutation.promise
    })
  })

  it('does not target a detached selector when an in-flight save settles after unmount', async () => {
    const mutation = Promise.withResolvers<ReturnType<typeof ok<SettingsNamespaceView>>>()
    const controller = derivedController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] })),
        mutate: () => mutation.promise,
      },
    })
    const rendered = mount(controller)
    fireEvent.click(await screen.findByRole('button', { name: '仅可查看' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '可写入工作区' }))
    rendered.unmount()
    await act(async () => {
      mutation.resolve(ok(view('workspace-write', 1)))
      await mutation.promise
    })
  })
})
