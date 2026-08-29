/** Cross-engine accessibility modes over the assembled Web application. */

import type { Browser, Locator, Page } from 'playwright'
import { chromium, firefox, webkit } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { saveFailureShot, writeComposerDraft } from './support.ts'

const browserTypes = { chromium, firefox, webkit }
type BrowserName = keyof typeof browserTypes

function selectedBrowser(): BrowserName {
  const name = process.env.DSH_A11Y_BROWSER
  if (name === 'chromium' || name === 'firefox' || name === 'webkit') return name
  throw new Error(`DSH_A11Y_BROWSER must be chromium, firefox, or webkit; got ${JSON.stringify(name)}`)
}

const browserName = selectedBrowser()
const SEED_ID = 'accessibility-modes-seed'

/** One closed Session keeps the tree semantics and keyboard contract present in every engine. */
function seedLog(): string {
  const time = 1788048000000
  const at = (index: number, event: Record<string, unknown>): string => (
    JSON.stringify({ ...event, seq: index, time: time + index })
  )
  return [
    JSON.stringify({ type: 'session', version: 0, id: '{{sessionId}}', createdAt: time, cwd: '{{cwd}}' }),
    at(0, { type: 'turn/start', data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user', rpcId: 'seed' } } } }),
    at(1, {
      type: 'user/message',
      data: { content: [{ type: 'text', text: 'Accessibility seed.' }], source: { kind: 'user', rpcId: 'seed' } },
      surfaceOp: 'append',
    }),
    at(2, { type: 'session/title', data: { title: 'Accessibility seed', messageSeqs: [1], source: { kind: 'fallback' } } }),
    at(3, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }),
  ].join('\n')
}

interface FocusGeometry {
  tag: string
  label: string
  rect: { top: number; right: number; bottom: number; left: number; width: number; height: number }
  viewport: { width: number; height: number }
  scrolledAncestors: Array<{ tag: string; className: string; scrollLeft: number; scrollTop: number }>
  insideViewport: boolean
  unobscured: boolean
  focusVisible: boolean
}

async function focusedGeometry(page: Page): Promise<FocusGeometry> {
  return await page.evaluate(() => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || active === document.body) {
      return {
        tag: active?.tagName ?? 'none', label: '',
        rect: { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        scrolledAncestors: [],
        insideViewport: false, unobscured: false, focusVisible: false,
      }
    }
    const rect = active.getBoundingClientRect()
    const centerX = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2))
    const centerY = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2))
    const hit = document.elementFromPoint(centerX, centerY)
    return {
      tag: active.tagName.toLowerCase(),
      label: active.getAttribute('aria-label') ?? active.textContent?.trim().slice(0, 80) ?? '',
      rect: {
        top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left,
        width: rect.width, height: rect.height,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrolledAncestors: [...document.querySelectorAll<HTMLElement>('body *')]
        .filter(element => (element.scrollLeft !== 0 || element.scrollTop !== 0) && element.contains(active))
        .map(element => ({
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === 'string' ? element.className : '',
          scrollLeft: element.scrollLeft,
          scrollTop: element.scrollTop,
        })),
      insideViewport: rect.width > 0
        && rect.height > 0
        && rect.left >= -1
        && rect.top >= -1
        && rect.right <= window.innerWidth + 1
        && rect.bottom <= window.innerHeight + 1,
      unobscured: hit !== null && (active.contains(hit) || hit.contains(active)),
      focusVisible: active.matches(':focus-visible'),
    }
  })
}

async function expectFocusedAndUnobscured(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => { resolve() })))
  const geometry = await focusedGeometry(page)
  expect(geometry, `${browserName}: focused geometry ${JSON.stringify(geometry)}`).toMatchObject({
    insideViewport: true,
    unobscured: true,
    focusVisible: true,
  })
}

async function tabTo(page: Page, target: Locator, limit = 60): Promise<void> {
  const targetElement = await target.elementHandle()
  if (targetElement === null) throw new Error(`${browserName}: keyboard target is not attached`)
  for (let index = 0; index < limit; index++) {
    await pressForwardTab(page)
    if (await targetElement.evaluate(element => document.activeElement === element)) return
  }
  throw new Error(`${browserName}: keyboard focus did not reach the target after ${String(limit)} Tab presses`)
}

async function pressForwardTab(page: Page): Promise<void> {
  // macOS WebKit follows the host's keyboard-navigation preference. Option+Tab
  // is Safari's user-facing way to include every control when that preference
  // is disabled; other engines and WebKitGTK use plain Tab.
  await page.keyboard.press(browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab')
}

describe(`web accessibility modes: ${browserName}`, () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, seedLog(), SEED_ID)
    browser = await browserTypes[browserName].launch()
    page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('heading', { level: 1, name: 'DSH application' }).waitFor({ timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('operates the seeded Session tree and search with hierarchy and focus-return keys', async () => {
    onTestFailed(() => saveFailureShot(page, `web-accessibility-${browserName}-tree-keys`))
    await page.setViewportSize({ width: 1280, height: 900 })
    const tree = page.getByRole('tree', { name: 'Sessions' })
    const workspaceRow = tree.locator('[role="treeitem"][aria-level="1"][aria-expanded]').first()
    const sessionRow = tree.locator('[role="treeitem"][aria-level="2"]').first()
    await workspaceRow.waitFor()

    await workspaceRow.focus()
    expect(await workspaceRow.getAttribute('tabindex')).toBe('0')
    if (await workspaceRow.getAttribute('aria-expanded') === 'false') {
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => workspaceRow.getAttribute('aria-expanded')).toBe('true')
    }
    await sessionRow.waitFor()
    await page.keyboard.press('ArrowRight')
    expect(await sessionRow.evaluate(element => document.activeElement === element)).toBe(true)
    expect(await workspaceRow.getAttribute('tabindex')).toBe('-1')
    expect(await sessionRow.getAttribute('tabindex')).toBe('0')

    await page.keyboard.press('ArrowLeft')
    expect(await workspaceRow.evaluate(element => document.activeElement === element)).toBe(true)
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => workspaceRow.getAttribute('aria-expanded')).toBe('false')

    const searchButton = page.getByRole('button', { name: 'Search sessions' })
    const searchInput = page.locator('input[aria-label="Search sessions..."]')
    expect(await searchInput.getAttribute('aria-hidden')).toBe('true')
    await searchButton.click()
    expect(await searchInput.evaluate(element => document.activeElement === element)).toBe(true)
    await page.keyboard.press('Escape')
    expect(await searchButton.evaluate(element => document.activeElement === element)).toBe(true)
    expect(await searchInput.getAttribute('aria-hidden')).toBe('true')
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps the assembled core surface named and reflowed at 200% and 400% equivalents', async () => {
    onTestFailed(() => saveFailureShot(page, `web-accessibility-${browserName}-reflow`))
    await page.getByRole('complementary', { name: 'Session navigation' }).waitFor()
    await page.getByRole('main').waitFor()
    await page.getByRole('tree', { name: 'Sessions' }).waitFor()
    const settings = page.getByRole('button', { name: 'Settings', exact: true })
    const workspace = page.getByRole('textbox', { name: 'Choose workspace' })

    for (const width of [640, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { timeout: 5_000 })
        .toBeLessThanOrEqual(width)
      await expect.poll(() => settings.isVisible(), { timeout: 5_000 }).toBe(true)
      await expect.poll(() => workspace.isVisible(), { timeout: 5_000 }).toBe(true)
      const main = await page.getByRole('main').boundingBox()
      expect(main).not.toBeNull()
      expect(main!.x).toBeGreaterThanOrEqual(-1)
      expect(main!.x + main!.width).toBeLessThanOrEqual(width + 1)
    }
  })

  it('keeps keyboard focus visible and unobscured in the narrow shell and Settings modal', async () => {
    onTestFailed(() => saveFailureShot(page, `web-accessibility-${browserName}-focus`))
    await page.setViewportSize({ width: 320, height: 568 })
    await page.evaluate(() => {
      const active = document.activeElement
      if (active instanceof HTMLElement) active.blur()
    })
    const settings = page.getByRole('button', { name: 'Settings', exact: true })
    await tabTo(page, settings)
    const settingsElement = await settings.elementHandle()
    expect(settingsElement).not.toBeNull()
    await expectFocusedAndUnobscured(page)
    await page.keyboard.press('Enter')

    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 10_000 })
    const dialogBox = await dialog.boundingBox()
    expect(dialogBox).not.toBeNull()
    expect(dialogBox!.x).toBeGreaterThanOrEqual(-1)
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(321)
    const navButtons = dialog.locator('nav button')
    const navCount = await navButtons.count()
    expect(navCount).toBeGreaterThan(0)
    for (let index = 0; index < navCount; index++) {
      const navButton = navButtons.nth(index)
      await navButton.click()
      await expect.poll(() => navButton.getAttribute('aria-current')).toBe('true')
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => { resolve() })))
      const overflow = await dialog.evaluate(element => [...element.querySelectorAll<HTMLElement>('*')]
        .filter((candidate) => {
          const rect = candidate.getBoundingClientRect()
          const style = getComputedStyle(candidate)
          return rect.width > 1
            && rect.height > 1
            && style.overflowX !== 'hidden'
            && candidate.scrollWidth > candidate.clientWidth + 1
        })
        .map(candidate => ({
          tag: candidate.tagName.toLowerCase(),
          role: candidate.getAttribute('role'),
          label: candidate.getAttribute('aria-label'),
          className: candidate.className,
          clientWidth: candidate.clientWidth,
          scrollWidth: candidate.scrollWidth,
        }))
        .slice(0, 12))
      const section = await navButton.textContent()
      expect(overflow, `${browserName}: Settings ${JSON.stringify(section?.trim())} must reflow at 320 CSS px`).toEqual([])
    }

    for (let index = 0; index < 16; index++) {
      await pressForwardTab(page)
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
      await expectFocusedAndUnobscured(page)
    }
    await page.keyboard.press('Escape')
    await expect.poll(() => dialog.count()).toBe(0)
    expect(await settingsElement!.evaluate(element => document.activeElement === element)).toBe(true)
    await expectFocusedAndUnobscured(page)
  })

  it.skipIf(browserName !== 'chromium')('preserves system-controlled colors and focus in Windows forced-colors mode', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-accessibility-chromium-forced-colors'))
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.emulateMedia({ forcedColors: 'active' })
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true)

    const settings = page.getByRole('button', { name: 'Settings', exact: true })
    await settings.focus()
    expect(await settings.evaluate(element => getComputedStyle(element).forcedColorAdjust)).toBe('auto')
    const colors = await settings.evaluate((element) => {
      const style = getComputedStyle(element)
      return { foreground: style.color, background: style.backgroundColor, outline: style.outlineColor }
    })
    expect(colors.foreground).not.toBe(colors.background)
    expect(colors.outline).not.toBe(colors.background)
    await page.emulateMedia({ forcedColors: 'none' })
  })

  it('honors reduced motion without removing core information or controls', async () => {
    onTestFailed(() => saveFailureShot(page, `web-accessibility-${browserName}-reduced-motion`))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
    await page.getByRole('heading', { level: 1, name: 'DSH application' }).waitFor()
    await page.getByRole('textbox', { name: 'Choose workspace' }).waitFor()
    await page.locator('button[aria-haspopup="dialog"][aria-expanded]').waitFor()
    await expect.poll(() => page.evaluate(() => document.getAnimations()
      .filter(animation => animation.playState === 'running').length), { timeout: 5_000 }).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('operates the assembled model menu and command combobox with one current item', async () => {
    onTestFailed(() => saveFailureShot(page, `web-accessibility-${browserName}-model-command`))
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
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
  })
})
