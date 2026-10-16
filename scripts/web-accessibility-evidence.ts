/** Emit exact-revision, machine-readable non-AT evidence for the assembled P0 Web routes. */

import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { arch, platform, release, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'
import { promisify } from 'node:util'
import { pnpmInvocation } from './pnpm-invocation.ts'

export const NON_AT_BROWSER_PROTOCOL = 'dsh-non-at-browser/1.0.0-draft' as const
export const CORE_BROWSER_EVIDENCE = 'dsh-core-browser-non-at' as const
export const CORE_BROWSER_SCHEMA = 'https://raw.githubusercontent.com/omdsh-dev/dsh-accessibility/main/CORE-BROWSER-EVIDENCE.schema.json' as const

const supported = ['chromium', 'firefox', 'webkit'] as const
export type BrowserName = typeof supported[number]

type VitestStatus = 'passed' | 'failed' | 'pending' | 'skipped' | 'todo'

interface VitestAssertion {
  title: string
  status: VitestStatus
  failureMessages?: string[]
}

export interface VitestJsonReport {
  success: boolean
  numTotalTests: number
  numPassedTests: number
  numFailedTests: number
  numPendingTests: number
  numTodoTests: number
  testResults: Array<{ assertionResults: VitestAssertion[] }>
}

interface CheckDefinition {
  id: string
  title: string
  engines: 'all' | 'chromium-only'
}

export const REQUIRED_CHECKS: readonly CheckDefinition[] = [
  {
    id: 'core.shell-and-splitters',
    title: 'publishes named shell landmarks and operates both window splitters without a pointer',
    engines: 'all',
  },
  {
    id: 'core.workspace-tree-and-search',
    title: 'operates the Workspace tree and search without a pointer',
    engines: 'all',
  },
  {
    id: 'core.session-view-tabs',
    title: 'operates the named Session views as one keyboard tab stop',
    engines: 'all',
  },
  {
    id: 'core.trajectory-navigation',
    title: 'navigates Trajectory events and their details without repeated row Tab stops',
    engines: 'all',
  },
  {
    id: 'core.composer-draft',
    title: 'edits and clears a composer draft without submitting it',
    engines: 'all',
  },
  {
    id: 'core.model-and-command-menus',
    title: 'operates the assembled model menu and command combobox with one current item',
    engines: 'all',
  },
  {
    id: 'core.file-disclosure',
    title: 'separates file disclosure and open-file keyboard actions',
    engines: 'all',
  },
  {
    id: 'core.settings-focus',
    title: 'contains Settings focus, inerts the app, and restores the trigger',
    engines: 'all',
  },
  {
    id: 'core.full-access-risk',
    title: 'operates Full access risk admission and returns to its durable owner',
    engines: 'all',
  },
  {
    id: 'environment.reflow',
    title: 'keeps the named core surface reflowed at 200% and 400% equivalents',
    engines: 'all',
  },
  {
    id: 'environment.transcript',
    title: 'exposes a quiet named transcript with navigable message articles',
    engines: 'all',
  },
  {
    id: 'environment.focus-not-obscured',
    title: 'keeps keyboard focus visible and unobscured across P0 routes at the 400% equivalent',
    engines: 'all',
  },
  {
    id: 'environment.forced-colors',
    title: 'preserves system colors and focus in forced-colors mode',
    engines: 'chromium-only',
  },
  {
    id: 'environment.reduced-motion',
    title: 'honors reduced motion without removing core information or controls',
    engines: 'all',
  },
] as const

export const CORE_TASKS = [
  { id: 'discover-structure', checks: ['core.shell-and-splitters'] },
  { id: 'navigate-sessions', checks: ['core.workspace-tree-and-search'] },
  { id: 'search-sessions', checks: ['core.workspace-tree-and-search'] },
  { id: 'adjust-layout', checks: ['core.shell-and-splitters'] },
  { id: 'switch-session-view', checks: ['core.session-view-tabs'] },
  {
    id: 'read-conversation',
    checks: ['environment.transcript', 'core.file-disclosure'],
  },
  { id: 'inspect-trajectory', checks: ['core.trajectory-navigation'] },
  { id: 'configure-settings', checks: ['core.settings-focus'] },
  { id: 'edit-composer-draft', checks: ['core.composer-draft'] },
] as const

export interface EngineEvidence {
  engine: BrowserName
  engineVersion: string
  testProcess: {
    success: true
    total: number
    passed: number
    notRun: number
    failed: 0
  }
  checks: Array<{
    id: string
    status: 'passed' | 'not-run'
  }>
}

export interface CoreBrowserEvidenceReport {
  $schema: typeof CORE_BROWSER_SCHEMA
  protocol: typeof NON_AT_BROWSER_PROTOCOL
  evidence: typeof CORE_BROWSER_EVIDENCE
  result: 'pass' | 'partial'
  generatedAt: string
  standards: string[]
  dsh: { package: '@deepseek-ai/dsh-root'; version: string; revision: string; dirty: false }
  environment: { os: NodeJS.Platform; osRelease: string; architecture: string; node: string }
  scope: {
    suite: 'dsh-core-p0-web'
    viewports: Array<{ width: 640 | 320; classification: '200%-equivalent' | '400%-equivalent' }>
    coreTasks: typeof CORE_TASKS
  }
  engines: EngineEvidence[]
  limitations: string[]
}

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(import.meta.dirname, '..')
interface BrowserLauncher {
  launch(): Promise<{ version(): string; close(): Promise<void> }>
}
const webRequire = createRequire(join(repositoryRoot, 'apps/web/package.json'))
const browserTypes = webRequire('playwright') as Record<BrowserName, BrowserLauncher>

/** Parse an exact, duplicate-free browser subset. */
export function parseBrowsers(raw: string | undefined): BrowserName[] {
  const values = (raw ?? supported.join(',')).split(',')
  if (values.length === 0 || values.some(value => !supported.includes(value as BrowserName))) {
    throw new Error(
      `browsers must be a comma-separated subset of ${supported.join(',')}; got ${JSON.stringify(raw)}`,
    )
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`browsers must not contain duplicates; got ${JSON.stringify(raw)}`)
  }
  return values as BrowserName[]
}

/** Refuse release evidence from a checkout whose tracked or untracked state differs from HEAD. */
export function assertCleanStatus(status: string): void {
  if (status.trim() !== '') {
    throw new Error('non-AT browser evidence requires a clean Git worktree')
  }
}

/** Convert Vitest JSON into fail-closed per-check evidence for one engine. */
export function engineEvidence(
  engine: BrowserName,
  engineVersion: string,
  report: VitestJsonReport,
): EngineEvidence {
  if (!report.success || report.numFailedTests !== 0) {
    throw new Error(`${engine}: accessibility Vitest process did not pass`)
  }
  const assertions = report.testResults.flatMap(result => result.assertionResults)
  const byTitle = new Map<string, VitestAssertion>()
  for (const assertion of assertions) {
    if (byTitle.has(assertion.title)) {
      throw new Error(`${engine}: duplicate accessibility assertion ${JSON.stringify(assertion.title)}`)
    }
    byTitle.set(assertion.title, assertion)
  }

  const checks = REQUIRED_CHECKS.map((definition) => {
    const assertion = byTitle.get(definition.title)
    if (assertion === undefined) {
      throw new Error(`${engine}: missing required accessibility assertion ${definition.id}`)
    }
    const shouldRun = definition.engines === 'all' || engine === 'chromium'
    if (shouldRun && assertion.status !== 'passed') {
      throw new Error(`${engine}: required accessibility assertion ${definition.id} was ${assertion.status}`)
    }
    if (!shouldRun && !['pending', 'skipped', 'todo'].includes(assertion.status)) {
      throw new Error(`${engine}: unsupported forced-colors assertion must be not-run, got ${assertion.status}`)
    }
    return { id: definition.id, status: shouldRun ? 'passed' as const : 'not-run' as const }
  })

  return {
    engine,
    engineVersion,
    testProcess: {
      success: true,
      total: report.numTotalTests,
      passed: report.numPassedTests,
      notRun: report.numPendingTests + report.numTodoTests,
      failed: 0,
    },
    checks,
  }
}

/** Build one schema-addressed exact-revision report. */
export function buildEvidenceReport(input: {
  version: string
  revision: string
  generatedAt: string
  engines: EngineEvidence[]
}): CoreBrowserEvidenceReport {
  if (!/^[0-9a-f]{40}$/u.test(input.revision)) {
    throw new Error(`DSH revision must be a full 40-character Git object id; got ${input.revision}`)
  }
  const selected = input.engines.map(result => result.engine)
  if (new Set(selected).size !== selected.length) throw new Error('evidence contains duplicate engines')
  const full = supported.every(engine => selected.includes(engine)) && selected.length === supported.length
  return {
    $schema: CORE_BROWSER_SCHEMA,
    protocol: NON_AT_BROWSER_PROTOCOL,
    evidence: CORE_BROWSER_EVIDENCE,
    result: full ? 'pass' : 'partial',
    generatedAt: input.generatedAt,
    standards: [
      'WCAG-2.2:1.4.10',
      'WCAG-2.2:2.4.7',
      'WCAG-2.2:2.4.11',
      'WCAG-2.2:2.3.3',
      'CSS-COLOR-ADJUST-1',
    ],
    dsh: {
      package: '@deepseek-ai/dsh-root',
      version: input.version,
      revision: input.revision,
      dirty: false,
    },
    environment: {
      os: platform(),
      osRelease: release(),
      architecture: arch(),
      node: process.version,
    },
    scope: {
      suite: 'dsh-core-p0-web',
      viewports: [
        { width: 640, classification: '200%-equivalent' },
        { width: 320, classification: '400%-equivalent' },
      ],
      coreTasks: CORE_TASKS,
    },
    engines: input.engines,
    limitations: [
      'headless browser evidence, not assistive-technology or disabled-user evidence',
      '320 CSS px is a 400% equivalent, not a real browser-zoom or text-only-zoom observation',
      'forced colors is Chromium emulation, not a Windows High Contrast observation',
      'sampled focus stacking does not replace visual focus-indicator contrast or pixel-area review',
      'synthetic automated task routes do not prove independent, effective, or safe human completion',
    ],
  }
}

async function runVitest(engine: BrowserName, jsonPath: string): Promise<void> {
  const invocation = pnpmInvocation([
    'exec',
    'vitest',
    'run',
    '--config',
    'vitest.web-accessibility.config.ts',
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${jsonPath}`,
  ])
  await new Promise<void>((resolveRun, reject) => {
    console.log(`Accessibility evidence browser gate: ${engine}`)
    const child = spawn(invocation.command, invocation.args, {
      cwd: repositoryRoot,
      stdio: 'inherit',
      env: { ...process.env, DSH_A11Y_BROWSER: engine, DSH_SNAPSHOT: 'replay' },
    })
    child.once('error', reject)
    child.once('exit', (exitCode, signalCode) => {
      if (signalCode !== null) {
        reject(new Error(`${engine}: accessibility gate terminated by ${signalCode}`))
      } else if (exitCode !== 0) {
        reject(new Error(`${engine}: accessibility gate exited ${String(exitCode)}`))
      } else {
        resolveRun()
      }
    })
  })
}

async function installedEngineVersion(engine: BrowserName): Promise<string> {
  const browser = await browserTypes[engine].launch()
  try {
    return browser.version()
  } finally {
    await browser.close()
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      browsers: { type: 'string' },
      output: { type: 'string', short: 'o' },
    },
    allowPositionals: false,
  })
  const selected = parseBrowsers(values.browsers ?? process.env.DSH_A11Y_BROWSERS)
  const output = resolve(repositoryRoot, values.output ?? '.artifacts/accessibility/core-browser-evidence.json')
  const [{ stdout: status }, { stdout: revision }, manifestText] = await Promise.all([
    execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repositoryRoot }),
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot }),
    readFile(join(repositoryRoot, 'package.json'), 'utf8'),
  ])
  assertCleanStatus(status)
  const manifest = JSON.parse(manifestText) as { name?: string; version?: string }
  if (manifest.name !== '@deepseek-ai/dsh-root' || manifest.version === undefined) {
    throw new Error('package.json does not identify a versioned @deepseek-ai/dsh-root checkout')
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-core-browser-evidence-'))
  try {
    const engines: EngineEvidence[] = []
    for (const engine of selected) {
      const jsonPath = join(temporaryRoot, `${engine}.json`)
      await runVitest(engine, jsonPath)
      const [engineVersion, reportText] = await Promise.all([
        installedEngineVersion(engine),
        readFile(jsonPath, 'utf8'),
      ])
      engines.push(engineEvidence(engine, engineVersion, JSON.parse(reportText) as VitestJsonReport))
    }
    const report = buildEvidenceReport({
      version: manifest.version,
      revision: revision.trim(),
      generatedAt: new Date().toISOString(),
      engines,
    })
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`Accessibility evidence: ${report.result} (${output})`)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  await main()
}
