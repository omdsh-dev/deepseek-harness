/** Tests for exact-revision core browser accessibility evidence. */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  assertCleanStatus,
  buildEvidenceReport,
  CORE_BROWSER_EVIDENCE,
  CORE_TASKS,
  engineEvidence,
  NON_AT_BROWSER_PROTOCOL,
  parseBrowsers,
  REQUIRED_CHECKS,
  type BrowserName,
  type EngineEvidence,
  type VitestJsonReport,
} from './web-accessibility-evidence.ts'

function vitestReport(engine: BrowserName): VitestJsonReport {
  const assertions = REQUIRED_CHECKS.map(check => ({
    title: check.title,
    status: check.engines === 'chromium-only' && engine !== 'chromium'
      ? 'pending' as const
      : 'passed' as const,
  }))
  const notRun = engine === 'chromium' ? 0 : 1
  return {
    success: true,
    numTotalTests: 14,
    numPassedTests: 14 - notRun,
    numFailedTests: 0,
    numPendingTests: notRun,
    numTodoTests: 0,
    testResults: [{ assertionResults: assertions }],
  }
}

function evidence(engine: BrowserName): EngineEvidence {
  return engineEvidence(engine, `${engine}-version`, vitestReport(engine))
}

describe('web accessibility evidence', () => {
  it('pins the shared non-AT protocol, core evidence kind, and nine catalog task ids', () => {
    expect(NON_AT_BROWSER_PROTOCOL).toBe('dsh-non-at-browser/1.0.0-draft')
    expect(CORE_BROWSER_EVIDENCE).toBe('dsh-core-browser-non-at')
    expect(CORE_TASKS.map(task => task.id)).toEqual([
      'discover-structure',
      'navigate-sessions',
      'search-sessions',
      'adjust-layout',
      'switch-session-view',
      'read-conversation',
      'inspect-trajectory',
      'configure-settings',
      'edit-composer-draft',
    ])
  })

  it('parses only an exact, duplicate-free engine subset', () => {
    expect(parseBrowsers(undefined)).toEqual(['chromium', 'firefox', 'webkit'])
    expect(parseBrowsers('webkit,chromium')).toEqual(['webkit', 'chromium'])
    expect(() => { parseBrowsers('') }).toThrow('comma-separated subset')
    expect(() => { parseBrowsers('chromium,chromium') }).toThrow('must not contain duplicates')
    expect(() => { parseBrowsers('chrome') }).toThrow('comma-separated subset')
  })

  it('accepts every required check and records unsupported forced colors as not-run', () => {
    expect(evidence('chromium').checks).toHaveLength(14)
    expect(evidence('firefox').checks.find(check => check.id === 'environment.forced-colors'))
      .toEqual({ id: 'environment.forced-colors', status: 'not-run' })
  })

  it('fails closed on missing, duplicate, failed, and unexpectedly run assertions', () => {
    const missing = vitestReport('chromium')
    missing.testResults[0]!.assertionResults.pop()
    expect(() => engineEvidence('chromium', 'version', missing)).toThrow('missing required')

    const duplicate = vitestReport('chromium')
    duplicate.testResults[0]!.assertionResults.push(duplicate.testResults[0]!.assertionResults[0]!)
    expect(() => engineEvidence('chromium', 'version', duplicate)).toThrow('duplicate')

    const failed = vitestReport('chromium')
    failed.success = false
    failed.numFailedTests = 1
    expect(() => engineEvidence('chromium', 'version', failed)).toThrow('did not pass')

    const unsupported = vitestReport('firefox')
    unsupported.testResults[0]!.assertionResults.find(assertion =>
      assertion.title === 'preserves system colors and focus in forced-colors mode')!.status = 'passed'
    expect(() => engineEvidence('firefox', 'version', unsupported)).toThrow('must be not-run')
  })

  it('calls only a complete three-engine record pass', () => {
    const base = {
      version: '0.1.2-alpha.2',
      revision: 'a'.repeat(40),
      generatedAt: '2026-08-31T10:00:00.000Z',
    }
    expect(buildEvidenceReport({ ...base, engines: [evidence('chromium')] }).result).toBe('partial')
    const report = buildEvidenceReport({
      ...base,
      engines: [evidence('chromium'), evidence('firefox'), evidence('webkit')],
    })
    expect(report.result).toBe('pass')
    expect(report.dsh).toMatchObject({ revision: 'a'.repeat(40), dirty: false })
    expect(report.limitations.join(' ')).toContain('not assistive-technology')
    expect(report.limitations.join(' ')).toContain('not a real browser-zoom')
    expect(report.limitations.join(' ')).toContain('not a Windows High Contrast')
    expect(report.limitations.join(' ')).toContain('do not prove independent')
  })

  it('rejects dirty worktrees, short revisions, and duplicate engine records', () => {
    expect(() => { assertCleanStatus(' M file.ts\n') }).toThrow('clean Git worktree')
    expect(() => { assertCleanStatus('') }).not.toThrow()
    expect(() => buildEvidenceReport({
      version: '0.1.2-alpha.2',
      revision: 'abc',
      generatedAt: '2026-08-31T10:00:00.000Z',
      engines: [evidence('chromium')],
    })).toThrow('40-character')
    expect(() => buildEvidenceReport({
      version: '0.1.2-alpha.2',
      revision: 'a'.repeat(40),
      generatedAt: '2026-08-31T10:00:00.000Z',
      engines: [evidence('chromium'), evidence('chromium')],
    })).toThrow('duplicate engines')
  })

  it('ships a schema pinned to the same protocol, evidence kind, and exact revision', () => {
    const schema = JSON.parse(readFileSync(
      new URL('./web-accessibility-evidence.schema.json', import.meta.url),
      'utf8',
    )) as {
      properties: {
        protocol: { const: string }
        evidence: { const: string }
        dsh: { properties: { revision: { pattern: string }; dirty: { const: boolean } } }
      }
    }
    expect(schema.properties.protocol.const).toBe(NON_AT_BROWSER_PROTOCOL)
    expect(schema.properties.evidence.const).toBe(CORE_BROWSER_EVIDENCE)
    expect(schema.properties.dsh.properties.revision.pattern).toBe('^[0-9a-f]{40}$')
    expect(schema.properties.dsh.properties.dirty.const).toBe(false)
  })
})
