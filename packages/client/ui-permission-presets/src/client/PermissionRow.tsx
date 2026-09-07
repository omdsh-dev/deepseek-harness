/**
 * Permission preference row: the default preset for subsequently created
 * sessions. Current-session switches remain on the composer `/permission`
 * control.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconChevronDownOutline14, Menu, RiskConfirmation,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PermissionSettingsState } from './settings-store.ts'
import type { PermissionSettingsKey } from './locales.ts'
import { displayPermissionPreset, FULL_ACCESS_PRESET } from './presentation.ts'
import css from './PermissionRow.module.css'

/** Registration-side business face for the host-backed preference. */
export interface PermissionRowInjected {
  hooks: {
    /** Permission settings snapshot bound by the renderer as usePermission. */
    permission: SnapshotStore<PermissionSettingsState>
  }
  /** Load the descriptor when the row first renders. */
  load: () => Promise<void>
  /** Persist one advertised preset. */
  select: (preset: string) => Promise<void>
}

/** Full component props. */
export type PermissionRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.permission'>
  & InjectFace<PermissionRowInjected>

/**
 * Render the new-session Permission default selector.
 * @param props - composed slot props.
 * @returns the row, or null when the host does not expose permission settings.
 */
export function PermissionRow({ load, select, usePermission, t }: PermissionRowProps) {
  const state = usePermission(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const [confirmingFullAccess, setConfirmingFullAccess] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const selectorRef = useRef<HTMLButtonElement>(null)
  const restoreAfterSaveRef = useRef(false)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (state.writable && state.status !== 'unavailable') return
    setOpen(false)
    setAcknowledged(false)
    setConfirmingFullAccess(false)
  }, [state.status, state.writable])

  const restoreSelectorWhenReady = useCallback((): void => {
    queueMicrotask(() => {
      if (!restoreAfterSaveRef.current) return
      const selector = selectorRef.current
      if (selector?.isConnected !== true || selector.disabled) return
      restoreAfterSaveRef.current = false
      selector.focus()
    })
  }, [])

  useEffect(() => {
    if (!restoreAfterSaveRef.current) return
    if (!state.writable || state.status === 'unavailable') {
      restoreAfterSaveRef.current = false
      return
    }
    if (state.status === 'loading' || state.status === 'saving') return
    restoreSelectorWhenReady()
  }, [restoreSelectorWhenReady, state.status, state.writable])

  if (state.status === 'unavailable') return null
  const selected = state.options.find(option => option.id === state.currentValue)
  const busy = state.status === 'loading' || state.status === 'saving' || confirmingFullAccess
  const optionLabel = (option: PermissionSettingsState['options'][number]): string =>
    displayPermissionPreset(option.id, option.label, t)
  const label = selected !== undefined ? optionLabel(selected) : (busy ? t('loading') : t('unavailable'))
  const description: string = state.error ?? t('description')

  const selectAndRestore = (id: string): void => {
    restoreAfterSaveRef.current = true
    void select(id).then(restoreSelectorWhenReady, restoreSelectorWhenReady)
  }

  return (
    <>
      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{t('title')}</div>
          <div className={css.desc} role={state.error === null ? undefined : 'alert'}>{description}</div>
        </div>
        <Menu
          open={open}
          onClose={() => { setOpen(false) }}
          items={state.options.map(option => ({
            id: option.id,
            label: optionLabel(option),
            selection: 'radio' as const,
          }))}
          selectedId={state.currentValue}
          onSelect={(id) => {
            setOpen(false)
            if (id === state.currentValue) return
            // The portaled menu row is transient. Give the shared Modal a
            // connected invoker and restore this durable owner after saving.
            selectorRef.current?.focus()
            if (id === FULL_ACCESS_PRESET) {
              setAcknowledged(false)
              setConfirmingFullAccess(true)
              return
            }
            selectAndRestore(id)
          }}
          align="end"
          portal
          anchor={(
            <button
              ref={selectorRef}
              type="button"
              className={css.selector}
              aria-haspopup="menu"
              aria-expanded={open}
              disabled={busy || !state.writable || state.options.length === 0}
              onClick={() => { setOpen(value => !value) }}
            >
              {label}
              <IconChevronDownOutline14 className={css.chevron} />
            </button>
          )}
        />
      </div>
      <RiskConfirmation
        open={confirmingFullAccess}
        title={t('confirm.title')}
        description={t('confirm.description')}
        acknowledgeLabel={t('confirm.acknowledge')}
        cancelLabel={t('confirm.cancel')}
        closeLabel={t('close')}
        confirmLabel={t('confirm.enable')}
        acknowledged={acknowledged}
        disabled={!state.writable || state.status === 'saving'}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => {
          setAcknowledged(false)
          setConfirmingFullAccess(false)
        }}
        onConfirm={() => {
          setAcknowledged(false)
          setConfirmingFullAccess(false)
          selectAndRestore(FULL_ACCESS_PRESET)
        }}
      />
    </>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Permission row copy. */
    'settings.permission': PermissionSettingsKey
  }
}
