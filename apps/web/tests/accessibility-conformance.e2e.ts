// Product-level accessibility conformance: run axe-core in the assembled Web
// composition, including the computed colors and slot-expanded DOM that jsdom
// component tests cannot observe. This is a deterministic browser regression
// gate, not certification of any screen reader's spoken output.
import type { AxeResults } from 'axe-core'
import axe from 'axe-core'
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  launchWebScaffold, realizeSeedFixture, seedSession, watchConsole, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

interface BrowserAxe {
  run: (context: Document, options: { resultTypes: string[] }) => Promise<AxeResults>
}

interface AxeWindow extends Window {
  axe: BrowserAxe
}

const SETTINGS_SECTIONS = ['通用设置', '模型', '插件', 'Agent 预设'] as const
const ACTIVE_SEED = fileURLToPath(new URL('./snapshots/seeded-history/seed.jsonl', import.meta.url))
const ACTIVE_SESSION_ID = 'accessibility-active-session'

async function auditPage(page: Page, label: string): Promise<void> {
  const results = await page.evaluate(async () => {
    const browserAxe = (window as unknown as AxeWindow).axe
    return browserAxe.run(document, { resultTypes: ['violations'] })
  })
  const violations = results.violations.map(violation => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map(node => ({
      target: node.target,
      html: node.html,
      failureSummary: node.failureSummary,
    })),
  }))
  expect(violations, `axe violations in ${label}`).toEqual([])
}

describe('web e2e: assembled accessibility conformance', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.addScriptTag({ content: axe.source })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  async function audit(label: string): Promise<void> {
    await auditPage(page, label)
  }

  async function openSettings() {
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })
    return dialog
  }

  async function selectSection(dialog: ReturnType<Page['getByRole']>, name: typeof SETTINGS_SECTIONS[number]) {
    const button = dialog.getByRole('button', { name, exact: true })
    await button.click()
    await expect.poll(() => button.getAttribute('aria-current'), { timeout: 5_000 }).toBe('true')
  }

  async function selectTheme(name: '浅色' | '深色', dark: boolean): Promise<void> {
    const dialog = await openSettings()
    await selectSection(dialog, '通用设置')
    const choice = dialog.getByRole('button', { name, exact: true })
    await choice.click()
    await expect.poll(() => choice.getAttribute('aria-pressed'), { timeout: 5_000 }).toBe('true')
    await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme')), {
      timeout: 5_000,
    }).toBe(dark)
    await page.keyboard.press('Escape')
    await expect.poll(() => page.getByRole('dialog', { name: '设置' }).count(), { timeout: 5_000 }).toBe(0)
  }

  async function auditSettings(theme: string): Promise<void> {
    const dialog = await openSettings()
    for (const section of SETTINGS_SECTIONS) {
      await selectSection(dialog, section)
      if (section === '插件') {
        await dialog.getByRole('tab', { name: '插件配置', exact: true }).click()
        await dialog.getByText('终端', { exact: true }).waitFor({ timeout: 10_000 })
        await audit(`${theme} settings / ${section} / 插件配置`)
        await dialog.getByRole('tab', { name: '插件列表', exact: true }).click()
        await dialog.getByRole('searchbox', { name: '搜索插件' }).waitFor({ timeout: 10_000 })
        await audit(`${theme} settings / ${section} / 插件列表`)
        continue
      }
      await audit(`${theme} settings / ${section}`)
    }
    await page.keyboard.press('Escape')
  }

  it('has no automatic violations in light and dark themes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-accessibility-conformance'))

    await selectTheme('浅色', false)
    await audit('light application shell')
    await auditSettings('light')

    await selectTheme('深色', true)
    await audit('dark application shell')
    await auditSettings('dark')

    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)
})

describe('web e2e: active conversation accessibility conformance', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await mkdir(join(scaffold.workspaceCwd, 'workspace'), { recursive: true })
    const fixture = await readFile(ACTIVE_SEED, 'utf8')
    await seedSession(
      scaffold,
      realizeSeedFixture(scaffold, fixture, ACTIVE_SESSION_ID),
      ACTIVE_SESSION_ID,
    )
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.emulateMedia({ colorScheme: 'light' })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.addScriptTag({ content: axe.source })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  async function openSeededConversation(): Promise<void> {
    const group = page.locator('[role="treeitem"]').first()
    await group.waitFor({ timeout: 15_000 })
    await group.click()
    const session = page.locator('[role="treeitem"]').nth(1)
    await session.waitFor({ timeout: 10_000 })
    await session.click()
    await page.getByText('DONE', { exact: true }).waitFor({ timeout: 15_000 })
  }

  it('covers settled history, expanded tool output, and open menus in both themes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-accessibility-active-conversation'))
    await openSeededConversation()
    await auditPage(page, 'light settled conversation')

    const toolDisclosure = page.locator('[data-tool] [aria-expanded="false"]').first()
    await toolDisclosure.waitFor({ timeout: 10_000 })
    await toolDisclosure.focus()
    await toolDisclosure.press('Enter')
    await auditPage(page, 'light expanded tool output')

    const model = page.getByRole('button', { name: /^Select model, current/ })
    await model.click()
    await page.getByRole('menu').waitFor({ timeout: 5_000 })
    await auditPage(page, 'light model menu')
    await page.keyboard.press('Escape')

    const permission = page.getByRole('button', { name: /^Access mode, current:/ })
    await permission.click()
    await page.getByRole('menu').waitFor({ timeout: 5_000 })
    await auditPage(page, 'light permission menu')
    await page.keyboard.press('Escape')

    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme')), {
      timeout: 5_000,
    }).toBe(true)
    await auditPage(page, 'dark expanded conversation')

    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)
})
