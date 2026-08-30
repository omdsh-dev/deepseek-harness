/** Cross-engine keyboard and screen-reader contracts over the assembled Web application. */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium, firefox, webkit } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  launchWebScaffold, seedSession, watchConsole, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

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
    const focusedItem = menu.locator('[role="menuitem"]:focus')
    await expect.poll(() => focusedItem.count()).toBe(1)
    await page.keyboard.press('End')
    await expect.poll(() => menu.locator('[role="menuitem"]:focus').count()).toBe(1)
    await page.keyboard.press('Home')
    await expect.poll(() => menu.locator('[role="menuitem"]:focus').count()).toBe(1)
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
