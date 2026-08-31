/** Cross-engine keyboard and screen-reader contracts over the assembled Web application. */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium, firefox, webkit } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  launchWebScaffold, seedSession, watchConsole, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot, writeComposerDraft } from './support.ts'

const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.jsonl', import.meta.url))
const browserTypes = { chromium, firefox, webkit }
type BrowserName = keyof typeof browserTypes

function selectedBrowser(): BrowserName {
  const name = process.env.DSH_A11Y_BROWSER
  if (name === 'chromium' || name === 'firefox' || name === 'webkit') return name
  throw new Error(`DSH_A11Y_BROWSER must be chromium, firefox, or webkit; got ${JSON.stringify(name)}`)
}

const browserName = selectedBrowser()

async function pressForwardTab(page: Page): Promise<void> {
  // macOS WebKit follows Safari's keyboard-navigation preference. Option+Tab
  // includes every control when that host preference is disabled.
  await page.keyboard.press(browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab')
}

async function pressBackwardTab(page: Page): Promise<void> {
  await page.keyboard.press(
    browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Shift+Tab' : 'Shift+Tab',
  )
}

async function tabTo(page: Page, target: Locator, limit = 80): Promise<void> {
  const targetElement = await target.elementHandle()
  if (targetElement === null) throw new Error(`${browserName}: keyboard target is not attached`)
  await page.evaluate(() => {
    // Firefox preserves the sequential-navigation origin after blur, while
    // Chromium restarts at the document. Park on a non-sequential body target
    // so every engine begins the following user Tab sequence at the same place.
    document.body.tabIndex = -1
    document.body.focus({ preventScroll: true })
  })
  for (let index = 0; index < limit; index++) {
    await pressForwardTab(page)
    if (await targetElement.evaluate(element => document.activeElement === element)) return
  }
  throw new Error(`${browserName}: keyboard focus did not reach the target after ${String(limit)} Tab presses`)
}

async function expectFocused(target: Locator): Promise<void> {
  expect(await target.evaluate(element => document.activeElement === element)).toBe(true)
  expect(await target.evaluate(element => element.matches(':focus-visible'))).toBe(true)
}

describe(`assembled core accessibility: ${browserName}`, () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const fixture = await readFile(SEED, 'utf8')
    await seedSession(scaffold, fixture, 'accessibility-seed-alpha')
    await seedSession(scaffold, fixture, 'accessibility-seed-beta')
    browser = await browserTypes[browserName].launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('publishes named shell landmarks and operates both window splitters without a pointer', async () => {
    onTestFailed(() => saveFailureShot(page, `core-accessibility-${browserName}-shell`))
    expect(await page.getByRole('navigation', { name: 'Sidebar' }).count()).toBe(1)
    expect(await page.getByRole('main').count()).toBe(1)

    const detailsPane = page.locator('#dsh-details-pane')
    expect(await detailsPane.getAttribute('aria-hidden')).toBe('true')
    expect(await detailsPane.evaluate(element => (element as HTMLElement).inert)).toBe(true)
    expect(await page.getByRole('complementary', { name: 'Details' }).count()).toBe(0)

    const sidebar = page.getByRole('separator', { name: 'Sidebar' })
    expect(await sidebar.getAttribute('aria-controls')).toBe('dsh-sidebar-pane')
    expect(await sidebar.getAttribute('aria-orientation')).toBe('vertical')
    const sidebarWidth = Number(await sidebar.getAttribute('aria-valuenow'))
    await tabTo(page, sidebar)
    await expectFocused(sidebar)
    await page.keyboard.press('ArrowRight')
    await expect.poll(async () => Number(await sidebar.getAttribute('aria-valuenow'))).toBe(sidebarWidth + 10)
    await page.keyboard.press('ArrowLeft')
    await expect.poll(async () => Number(await sidebar.getAttribute('aria-valuenow'))).toBe(sidebarWidth)

    // The details splitter is intentionally unavailable until a real,
    // non-blank Session owns the complementary pane. Enter one through the
    // same Workspace tree keyboard contract a screen-reader user receives.
    const tree = page.getByRole('tree', { name: 'Sessions' })
    await tree.waitFor({ timeout: 30_000 })
    const currentTreeEntry = tree.locator('[role="treeitem"][tabindex="0"]')
    await tabTo(page, currentTreeEntry)
    await page.keyboard.press('Home')
    const group = tree.getByRole('treeitem').first()
    if (await group.getAttribute('aria-expanded') === 'false') {
      await page.keyboard.press('ArrowRight')
    }
    await page.keyboard.press('ArrowRight')
    const firstSession = tree.getByRole('treeitem').nth(1)
    await expectFocused(firstSession)
    await page.keyboard.press('Enter')
    await expect.poll(() => firstSession.getAttribute('aria-selected'), { timeout: 15_000 }).toBe('true')

    const details = page.getByRole('separator', { name: 'Details' })
    await details.waitFor({ timeout: 15_000 })
    expect(await details.getAttribute('aria-controls')).toBe('dsh-details-pane')
    expect(await details.getAttribute('aria-valuenow')).toBe('0')
    await tabTo(page, details)
    await expectFocused(details)
    await page.keyboard.press('Enter')
    await expect.poll(() => details.getAttribute('aria-valuenow')).toBe('360')
    expect(await detailsPane.getAttribute('aria-hidden')).toBeNull()
    expect(await detailsPane.evaluate(element => (element as HTMLElement).inert)).toBe(false)
    expect(await page.getByRole('complementary', { name: 'Details' }).count()).toBe(1)
    await expectFocused(details)
    await page.keyboard.press('Enter')
    await expect.poll(() => details.getAttribute('aria-valuenow')).toBe('0')
    expect(await detailsPane.getAttribute('aria-hidden')).toBe('true')
    expect(await detailsPane.evaluate(element => (element as HTMLElement).inert)).toBe(true)
    await expectFocused(details)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('operates the Workspace tree and search without a pointer', async () => {
    onTestFailed(() => saveFailureShot(page, `core-accessibility-${browserName}-workspace-tree`))
    const tree = page.getByRole('tree', { name: 'Sessions' })
    await tree.waitFor({ timeout: 30_000 })
    await expect.poll(() => tree.getByRole('treeitem').count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1)

    const sequentialRows = tree.locator('[role="treeitem"][tabindex="0"]')
    expect(await sequentialRows.count()).toBe(1)
    await tabTo(page, sequentialRows)
    await expectFocused(sequentialRows)

    await page.keyboard.press('Home')
    const group = tree.getByRole('treeitem').first()
    await expectFocused(group)
    expect(await group.getAttribute('aria-level')).toBe('1')
    if (await group.getAttribute('aria-expanded') === 'false') {
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => group.getAttribute('aria-expanded')).toBe('true')
    }
    await expect.poll(() => tree.getByRole('treeitem').count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(3)
    await page.keyboard.press('ArrowRight')
    const firstSession = tree.getByRole('treeitem').nth(1)
    await expectFocused(firstSession)
    expect(await firstSession.getAttribute('aria-level')).toBe('2')

    await page.keyboard.press('ArrowDown')
    const secondSession = tree.getByRole('treeitem').nth(2)
    await expectFocused(secondSession)
    await page.keyboard.press('u')
    await expectFocused(group)

    const groupAction = group.getByRole('button').first()
    await expect.poll(() => groupAction.isVisible()).toBe(true)
    await pressForwardTab(page)
    await expectFocused(groupAction)
    await pressBackwardTab(page)
    await expectFocused(group)

    const searchButton = page.getByRole('button', { name: 'Search sessions' })
    await tabTo(page, searchButton)
    await page.keyboard.press('Enter')
    // CSS keeps addressing the same input after collapse removes it from the
    // accessibility tree with aria-hidden.
    const searchInput = page.locator('input[aria-label="Search sessions..."]')
    await expectFocused(searchInput)
    expect(await searchInput.getAttribute('aria-hidden')).toBeNull()
    await page.keyboard.press('Escape')
    await expectFocused(searchButton)
    expect(await searchButton.getAttribute('aria-expanded')).toBe('false')
    expect(await searchInput.getAttribute('aria-hidden')).toBe('true')
    expect(await searchInput.getAttribute('tabindex')).toBe('-1')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('operates the named Session views as one keyboard tab stop', async () => {
    onTestFailed(() => saveFailureShot(page, `core-accessibility-${browserName}-session-views`))
    const tablist = page.getByRole('tablist', { name: 'Session views' })
    await tablist.waitFor({ timeout: 15_000 })
    const chat = tablist.getByRole('tab', { name: 'Chat' })
    const trajectory = tablist.getByRole('tab', { name: 'Trajectory' })
    const panel = page.getByRole('tabpanel', { name: 'Chat' })

    expect(await tablist.locator('[role="tab"][tabindex="0"]').count()).toBe(1)
    expect(await chat.getAttribute('aria-controls')).toBe(await panel.getAttribute('id'))
    expect(await panel.getAttribute('aria-labelledby')).toBe(await chat.getAttribute('id'))
    await tabTo(page, chat)
    await expectFocused(chat)

    await page.keyboard.press('ArrowRight')
    await expectFocused(trajectory)
    await expect.poll(() => trajectory.getAttribute('aria-selected')).toBe('true')
    await expect.poll(() => page.getByRole('tabpanel', { name: 'Trajectory' }).count()).toBe(1)
    expect(await tablist.locator('[role="tab"][tabindex="0"]').count()).toBe(1)

    await page.keyboard.press('Home')
    await expectFocused(chat)
    await expect.poll(() => chat.getAttribute('aria-selected')).toBe('true')
    await page.keyboard.press('End')
    await expectFocused(trajectory)
    await page.keyboard.press('ArrowRight')
    await expectFocused(chat)
    await expect.poll(() => chat.getAttribute('aria-selected')).toBe('true')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('navigates Trajectory events and their details without repeated row Tab stops', async () => {
    onTestFailed(() => saveFailureShot(page, `core-accessibility-${browserName}-trajectory`))
    const sessionTabs = page.getByRole('tablist', { name: 'Session views' })
    const chat = sessionTabs.getByRole('tab', { name: 'Chat' })
    const trajectory = sessionTabs.getByRole('tab', { name: 'Trajectory' })
    await tabTo(page, chat)
    await page.keyboard.press('ArrowRight')
    await expectFocused(trajectory)

    const table = page.getByRole('table', { name: 'Trajectory events' })
    await table.waitFor({ timeout: 15_000 })
    const rows = table.locator('tr[data-trajectory-row-key]:not([data-request-only])')
    const tabbableRows = table.locator(
      'tr[data-trajectory-row-key]:not([data-request-only])[tabindex="0"]',
    )
    await expect.poll(() => rows.count()).toBeGreaterThan(1)
    expect(await tabbableRows.count()).toBe(1)
    const firstStop = tabbableRows
    const firstKey = await firstStop.getAttribute('data-trajectory-row-key')
    await tabTo(page, firstStop)
    await expectFocused(firstStop)
    await page.keyboard.press('ArrowDown')
    const next = table.locator('tr[data-trajectory-row-key]:focus')
    await expect.poll(() => next.count()).toBe(1)
    expect(await next.getAttribute('data-trajectory-row-key')).not.toBe(firstKey)
    expect(await tabbableRows.count()).toBe(1)

    await page.keyboard.press('Enter')
    const details = page.getByRole('complementary', { name: 'Event details' })
    await details.waitFor({ timeout: 10_000 })
    const detailTabs = details.getByRole('tablist', { name: 'Event details' })
    expect(await detailTabs.locator('[role="tab"][tabindex="0"]').count()).toBe(1)
    const activeTab = detailTabs.locator('[role="tab"][aria-selected="true"]')
    await tabTo(page, activeTab)
    await expectFocused(activeTab)
    await page.keyboard.press('ArrowRight')
    const nextTab = detailTabs.locator('[role="tab"]:focus')
    await expect.poll(() => nextTab.count()).toBe(1)
    expect(await nextTab.getAttribute('aria-selected')).toBe('true')
    const panel = details.getByRole('tabpanel')
    expect(await panel.getAttribute('aria-labelledby')).toBe(await nextTab.getAttribute('id'))

    const splitter = details.getByRole('separator', { name: 'Resize event details' })
    expect(await splitter.getAttribute('aria-controls')).toBe('trajectory-detail-panel')
    const minimum = Number(await splitter.getAttribute('aria-valuemin'))
    const maximum = Number(await splitter.getAttribute('aria-valuemax'))
    const initial = Number(await splitter.getAttribute('aria-valuenow'))
    expect(minimum).toBeLessThan(initial)
    expect(maximum).toBeGreaterThan(initial)
    await tabTo(page, splitter)
    await expectFocused(splitter)
    await page.keyboard.press('ArrowLeft')
    await expect.poll(async () => Number(await splitter.getAttribute('aria-valuenow'))).toBe(initial + 16)
    await page.keyboard.press('Home')
    await expect.poll(async () => Number(await splitter.getAttribute('aria-valuenow'))).toBe(minimum)
    await page.keyboard.press('End')
    await expect.poll(async () => Number(await splitter.getAttribute('aria-valuenow'))).toBe(maximum)
    await page.keyboard.press('Enter')
    await expect.poll(async () => Number(await splitter.getAttribute('aria-valuenow'))).toBe(initial)
    await expectFocused(splitter)

    const close = details.getByRole('button', { name: 'Close details' })
    await tabTo(page, close)
    await page.keyboard.press('Enter')
    await expect.poll(() => details.count()).toBe(0)
    await tabTo(page, trajectory)
    await page.keyboard.press('ArrowLeft')
    await expectFocused(chat)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('operates the assembled model menu and command combobox with one current item', async () => {
    onTestFailed(() => saveFailureShot(page, `core-accessibility-${browserName}-model-command`))
    await page.setViewportSize({ width: 1280, height: 900 })
    const tree = page.getByRole('tree', { name: 'Sessions' })
    const workspaceRow = tree.locator('[role="treeitem"][aria-level="1"][aria-expanded]').first()
    await workspaceRow.waitFor()
    if (await workspaceRow.getAttribute('aria-expanded') === 'false') {
      await workspaceRow.focus()
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => workspaceRow.getAttribute('aria-expanded')).toBe('true')
    }
    const sessionRow = tree.locator('[role="treeitem"][aria-level="2"]').first()
    await sessionRow.click()

    const trigger = page.getByRole('button', { name: /^Select model/ })
    await trigger.waitFor({ timeout: 15_000 })
    await trigger.focus()
    await page.keyboard.press('ArrowDown')
    const rootItem = page.getByRole('menuitem', { name: /^Model/ })
    await rootItem.waitFor()
    expect(await rootItem.evaluate(element => document.activeElement === element)).toBe(true)
    expect(await rootItem.getAttribute('tabindex')).toBe('-1')
    await page.keyboard.press('ArrowRight')

    const modelOption = page.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })
    await modelOption.waitFor()
    expect(await modelOption.getAttribute('aria-checked')).toBe('true')
    expect(await modelOption.evaluate(element => document.activeElement === element)).toBe(true)
    await page.keyboard.press('ArrowLeft')
    expect(await rootItem.evaluate(element => document.activeElement === element)).toBe(true)
    await page.keyboard.press('Escape')
    await expect.poll(() => page.getByRole('menu').count()).toBe(0)
    expect(await trigger.evaluate(element => document.activeElement === element)).toBe(true)

    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    await writeComposerDraft(page, input, '/model')
    await input.press('Enter')
    const combobox = page.getByRole('combobox', { name: 'Filter options' })
    const listbox = page.getByRole('listbox', { name: '/model matches' })
    await combobox.waitFor({ timeout: 10_000 })
    await listbox.waitFor()
    const option = listbox.getByRole('option', { name: 'DeepSeek-V4-Flash' })
    expect(await combobox.getAttribute('aria-controls')).toBe(await listbox.getAttribute('id'))
    expect(await combobox.getAttribute('aria-activedescendant')).toBe(await option.getAttribute('id'))
    expect(await option.getAttribute('aria-selected')).toBe('true')
    expect(await combobox.evaluate(element => document.activeElement === element)).toBe(true)
    await page.keyboard.press('Escape')
    await expect.poll(() => combobox.count()).toBe(0)
    await expect.poll(() => input.evaluate(element => document.activeElement === element)).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('contains Settings focus, inerts the app, and restores the trigger', async () => {
    onTestFailed(() => saveFailureShot(page, `core-accessibility-${browserName}-settings-modal`))
    const trigger = page.getByRole('button', { name: 'Settings', exact: true })
    await tabTo(page, trigger)
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 10_000 })
    expect(await page.locator('#root').evaluate(element => (element as HTMLElement).inert)).toBe(true)
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)

    const menuTrigger = dialog.locator('button[aria-haspopup="menu"]:not([disabled])').first()
    await expect.poll(() => menuTrigger.count()).toBe(1)
    await tabTo(page, menuTrigger)
    await expectFocused(menuTrigger)
    await page.keyboard.press('ArrowDown')
    const menu = page.getByRole('menu')
    await menu.waitFor({ timeout: 10_000 })
    expect(await menuTrigger.getAttribute('aria-expanded')).toBe('true')
    expect(await menuTrigger.getAttribute('aria-controls')).toBe(await menu.getAttribute('id'))
    expect(await menu.getAttribute('aria-labelledby')).toBe(await menuTrigger.getAttribute('id'))
    const choices = menu.locator('[role="menuitemradio"]')
    await expect.poll(() => choices.count()).toBeGreaterThan(1)
    await expect.poll(() => menu.locator('[role="menuitemradio"][aria-checked="true"]').count()).toBe(1)
    expect(await menu.locator('[role="menuitemradio"]:not([aria-checked])').count()).toBe(0)
    const focusedItem = menu.locator('[role="menuitemradio"]:focus')
    await expect.poll(() => focusedItem.count()).toBe(1)
    await page.keyboard.press('End')
    await expect.poll(() => menu.locator('[role="menuitemradio"]:focus').count()).toBe(1)
    await page.keyboard.press('Home')
    await expect.poll(() => menu.locator('[role="menuitemradio"]:focus').count()).toBe(1)
    await page.keyboard.press('Escape')
    await expect.poll(() => menu.count()).toBe(0)
    expect(await dialog.count()).toBe(1)
    await expectFocused(menuTrigger)

    await page.keyboard.press('ArrowDown')
    await page.getByRole('menu').waitFor({ timeout: 10_000 })
    await pressForwardTab(page)
    await expect.poll(() => page.getByRole('menu').count()).toBe(0)
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
    expect(await menuTrigger.evaluate(element => document.activeElement === element)).toBe(false)

    for (let index = 0; index < 20; index++) {
      await pressForwardTab(page)
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
    }
    for (let index = 0; index < 6; index++) {
      await pressBackwardTab(page)
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
    }

    await page.keyboard.press('Escape')
    await expect.poll(() => dialog.count()).toBe(0)
    await expectFocused(trigger)
    expect(await page.locator('#root').evaluate(element => (element as HTMLElement).inert)).toBe(false)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
