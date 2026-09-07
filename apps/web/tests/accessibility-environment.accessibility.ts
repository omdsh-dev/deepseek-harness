/** Cross-engine zoom, display-mode, and focus geometry over the built Web app. */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium, firefox, webkit } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const browserTypes = { chromium, firefox, webkit }
type BrowserName = keyof typeof browserTypes

function selectedBrowser(): BrowserName {
  const name = process.env.DSH_A11Y_BROWSER
  if (name === 'chromium' || name === 'firefox' || name === 'webkit') return name
  throw new Error(`DSH_A11Y_BROWSER must be chromium, firefox, or webkit; got ${JSON.stringify(name)}`)
}

const browserName = selectedBrowser()
const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.jsonl', import.meta.url))

interface FocusGeometry {
  tag: string
  label: string
  hit: { tag: string; label: string; className: string } | null
  pointerEvents: string
  layout: { frameColumns: string; mainLeft: number; sidebarRight: number }
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
        tag: active?.tagName ?? 'none', label: '', hit: null, pointerEvents: '',
        layout: { frameColumns: '', mainLeft: 0, sidebarRight: 0 },
        rect: { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        scrolledAncestors: [],
        insideViewport: false, unobscured: false, focusVisible: false,
      }
    }
    const rect = active.getBoundingClientRect()
    const centerX = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2))
    const centerY = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2))
    const pointerEvents = getComputedStyle(active).pointerEvents
    const inlinePointerEvents = active.style.pointerEvents
    // A keyboard-restorable collapsed splitter intentionally ignores pointer
    // input. Temporarily admit it to hit testing so this samples visual stacking
    // instead of misclassifying pointer-events:none as paint obscuration.
    if (pointerEvents === 'none') active.style.pointerEvents = 'auto'
    const hit = document.elementFromPoint(centerX, centerY)
    active.style.pointerEvents = inlinePointerEvents
    const frame = document.querySelector<HTMLElement>('[style*="grid-template-columns"]')
    const main = document.querySelector<HTMLElement>('main')
    const sidebar = document.querySelector<HTMLElement>('nav[aria-label="Sidebar"]')
    return {
      tag: active.tagName.toLowerCase(),
      label: active.getAttribute('aria-label') ?? active.textContent?.trim().slice(0, 80) ?? '',
      hit: hit instanceof HTMLElement
        ? {
          tag: hit.tagName.toLowerCase(),
          label: hit.getAttribute('aria-label') ?? hit.textContent?.trim().slice(0, 80) ?? '',
          className: typeof hit.className === 'string' ? hit.className : '',
        }
        : null,
      pointerEvents,
      layout: {
        frameColumns: frame === null ? '' : getComputedStyle(frame).gridTemplateColumns,
        mainLeft: main?.getBoundingClientRect().left ?? 0,
        sidebarRight: sidebar?.getBoundingClientRect().right ?? 0,
      },
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

async function pressForwardTab(page: Page): Promise<void> {
  await page.keyboard.press(browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab')
}

async function tabTo(page: Page, target: Locator, limit = 80): Promise<void> {
  const targetElement = await target.elementHandle()
  if (targetElement === null) throw new Error(`${browserName}: keyboard target is not attached`)
  await page.evaluate(() => {
    document.body.tabIndex = -1
    document.body.focus({ preventScroll: true })
  })
  for (let index = 0; index < limit; index++) {
    await pressForwardTab(page)
    if (await targetElement.evaluate(element => document.activeElement === element)) return
  }
  throw new Error(`${browserName}: keyboard focus did not reach target after ${String(limit)} Tab presses`)
}

async function openSeededSession(page: Page): Promise<void> {
  const tree = page.getByRole('tree', { name: 'Sessions' })
  const group = tree.locator('[role="treeitem"][aria-level="1"][aria-expanded]').first()
  await group.waitFor({ timeout: 30_000 })
  if (await group.getAttribute('aria-expanded') === 'false') {
    await group.focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => group.getAttribute('aria-expanded')).toBe('true')
  }
  await tree.locator('[role="treeitem"][aria-level="2"]').first().click()
}

describe(`assembled accessibility environments: ${browserName}`, () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(SEED, 'utf8'), 'accessibility-environment-seed')
    browser = await browserTypes[browserName].launch()
    page = await newEnglishPage(browser, 900)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('heading', { level: 1, name: 'DSH application' }).waitFor({ timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps the named core surface reflowed at 200% and 400% equivalents', async () => {
    onTestFailed(() => saveFailureShot(page, `accessibility-environment-${browserName}-reflow`))
    const sidebar = page.getByRole('navigation', { name: 'Sidebar' })
    const main = page.getByRole('main')
    const settings = page.getByRole('button', { name: 'Settings', exact: true })
    const newSession = page.getByRole('button', { name: 'New session', exact: true })

    for (const width of [640, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { timeout: 5_000 })
        .toBeLessThanOrEqual(width)
      await expect.poll(() => settings.isVisible(), { timeout: 5_000 }).toBe(true)
      await expect.poll(() => newSession.isVisible(), { timeout: 5_000 }).toBe(true)
      for (const region of [sidebar, main]) {
        const box = await region.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.x).toBeGreaterThanOrEqual(-1)
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1)
      }
    }
  })

  it('exposes a quiet named transcript with navigable message articles', async () => {
    const transcriptPage = await newEnglishPage(browser, 900)
    const transcriptTripwire = watchConsole(transcriptPage)
    onTestFailed(() => saveFailureShot(
      transcriptPage, `accessibility-environment-${browserName}-transcript`,
    ))
    try {
      await transcriptPage.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await transcriptPage.getByRole('heading', { level: 1, name: 'DSH application' })
        .waitFor({ timeout: 30_000 })
      await openSeededSession(transcriptPage)
      const log = transcriptPage.getByRole('log', { name: 'Conversation transcript' })
      await log.waitFor()
      expect(await log.getAttribute('aria-live')).toBe('off')
      expect(await log.getAttribute('aria-busy')).toBe('false')
      expect(await log.getByRole('article', { name: 'User message' }).textContent())
        .toContain('Use the read tool twice')
      expect(await log.getByRole('article', { name: 'Assistant response' }).last().textContent())
        .toContain('DONE')
      expect(transcriptTripwire.pageErrors).toEqual([])
    } finally {
      await transcriptPage.close()
    }
  })

  it('keeps keyboard focus visible and unobscured across P0 routes at the 400% equivalent', async () => {
    const focusPage = await newEnglishPage(browser, 568)
    const focusTripwire = watchConsole(focusPage)
    onTestFailed(() => saveFailureShot(
      focusPage, `accessibility-environment-${browserName}-focus`,
    ))
    try {
      await focusPage.setViewportSize({ width: 320, height: 568 })
      await focusPage.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await focusPage.getByRole('heading', { level: 1, name: 'DSH application' })
        .waitFor({ timeout: 30_000 })

      const sidebarSplitter = focusPage.getByRole('separator', { name: 'Sidebar' })
      await tabTo(focusPage, sidebarSplitter)
      await expectFocusedAndUnobscured(focusPage)

      const searchButton = focusPage.getByRole('button', { name: 'Search sessions' })
      await tabTo(focusPage, searchButton)
      await expectFocusedAndUnobscured(focusPage)
      await focusPage.keyboard.press('Enter')
      const searchInput = focusPage.locator('input[aria-label="Search sessions..."]')
      await expect.poll(() => searchInput.evaluate(element => document.activeElement === element))
        .toBe(true)
      await expectFocusedAndUnobscured(focusPage)
      await focusPage.keyboard.press('Escape')
      await expectFocusedAndUnobscured(focusPage)

      const tree = focusPage.getByRole('tree', { name: 'Sessions' })
      const currentRow = tree.locator('[role="treeitem"][tabindex="0"]')
      await tabTo(focusPage, currentRow)
      await focusPage.keyboard.press('Home')
      const group = tree.locator('[role="treeitem"][aria-level="1"]').first()
      await expectFocusedAndUnobscured(focusPage)
      if (await group.getAttribute('aria-expanded') === 'false') {
        await focusPage.keyboard.press('ArrowRight')
      }
      await focusPage.keyboard.press('ArrowRight')
      const session = tree.locator('[role="treeitem"][aria-level="2"]').first()
      await expectFocusedAndUnobscured(focusPage)
      await focusPage.keyboard.press('Enter')
      await expect.poll(() => session.getAttribute('aria-selected'), { timeout: 15_000 }).toBe('true')

      const collapseSidebar = focusPage.getByRole('button', { name: 'Collapse sidebar', exact: true })
      if (await collapseSidebar.isVisible()) {
        await tabTo(focusPage, collapseSidebar)
        await expectFocusedAndUnobscured(focusPage)
        await focusPage.keyboard.press('Enter')
        await expect.poll(() => focusPage.getByRole('button', {
          name: 'Open sidebar', exact: true,
        }).isVisible()).toBe(true)
        await expectFocusedAndUnobscured(focusPage)
      }

      const tabs = focusPage.getByRole('tablist', { name: 'Session views' })
      const chat = tabs.getByRole('tab', { name: 'Chat' })
      await tabTo(focusPage, chat)
      await expectFocusedAndUnobscured(focusPage)

      const input = focusPage.locator('[data-composer-input][contenteditable="true"]').first()
      await tabTo(focusPage, input)
      await expectFocusedAndUnobscured(focusPage)

      await tabTo(focusPage, chat)
      await focusPage.keyboard.press('ArrowRight')
      await expectFocusedAndUnobscured(focusPage)
      const trajectoryRow = focusPage.getByRole('table', { name: 'Trajectory events' })
        .locator('tr[data-trajectory-row-key][tabindex="0"]')
      await tabTo(focusPage, trajectoryRow)
      await expectFocusedAndUnobscured(focusPage)

      const settings = focusPage.getByRole('button', { name: 'Settings', exact: true })
      const settingsElement = await settings.elementHandle()
      expect(settingsElement).not.toBeNull()
      await tabTo(focusPage, settings)
      await expectFocusedAndUnobscured(focusPage)
      await focusPage.keyboard.press('Enter')

      const dialog = focusPage.getByRole('dialog', { name: 'Settings' })
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
        await focusPage.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => {
          resolve()
        })))
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
        expect(overflow, `${browserName}: Settings ${JSON.stringify(section?.trim())} must reflow`)
          .toEqual([])
      }

      // Safari does not focus a clicked button by default. Re-enter keyboard
      // modality after the pointer-driven per-section geometry audit so focus
      // trap wraps retain a visible indicator.
      await focusPage.keyboard.press('ArrowDown')
      for (let index = 0; index < 16; index++) {
        await pressForwardTab(focusPage)
        expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
        await expectFocusedAndUnobscured(focusPage)
      }
      await focusPage.keyboard.press('Escape')
      await expect.poll(() => dialog.count()).toBe(0)
      expect(await settingsElement!.evaluate(element => document.activeElement === element)).toBe(true)
      await expectFocusedAndUnobscured(focusPage)
      expect(focusTripwire.pageErrors).toEqual([])
    } finally {
      await focusPage.close()
    }
  })

  it.skipIf(browserName !== 'chromium')('preserves system colors and focus in forced-colors mode', async () => {
    onTestFailed(() => saveFailureShot(page, 'accessibility-environment-chromium-forced-colors'))
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.emulateMedia({ forcedColors: 'active' })
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true)
    const settings = page.getByRole('button', { name: 'Settings', exact: true })
    const frame = page.locator('[style*="grid-template-columns"]').first()
    await expect.poll(() => frame.evaluate(element => Number.parseFloat(
      (element as HTMLElement).style.gridTemplateColumns,
    ))).toBeGreaterThanOrEqual(264)
    await expect.poll(() => frame.evaluate(element => element.getAnimations({ subtree: true })
      .filter(animation => animation.playState === 'running').length)).toBe(0)
    const main = page.getByRole('main')
    await expect.poll(async () => {
      const [settingsBox, mainBox] = await Promise.all([settings.boundingBox(), main.boundingBox()])
      return settingsBox !== null
        && mainBox !== null
        && settingsBox.x + settingsBox.width <= mainBox.x + 1
    }).toBe(true)
    await tabTo(page, settings)
    await expectFocusedAndUnobscured(page)
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
    onTestFailed(() => saveFailureShot(page, `accessibility-environment-${browserName}-motion`))
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
    await openSeededSession(page)
    await page.getByRole('heading', { level: 1, name: 'DSH application' }).waitFor()
    await page.getByRole('textbox', {
      name: 'Message or run a task... / commands, @ files or sessions',
    }).waitFor()
    await page.getByRole('button', { name: 'Settings', exact: true }).waitFor()
    await expect.poll(() => page.evaluate(() => document.getAnimations()
      .filter(animation => animation.playState === 'running').length), { timeout: 5_000 }).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
    await page.emulateMedia({ reducedMotion: 'no-preference' })
  })
})
