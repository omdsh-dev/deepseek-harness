/** Pin one PowerShell availability decision across a complete test invocation. */
import { spawnSync } from 'node:child_process'
import { resolvePwshPath } from '../packages/shell/pwsh-local/src/resolve.ts'

/** Internal environment fact inherited by Vitest workers and coverage-report merging. */
export const PWSH_TEST_AVAILABLE_ENV = 'DSH_TEST_PWSH_AVAILABLE'

/** Probe the same executable and command used by the real PowerShell suites. */
function probePwshTestAvailability(): boolean {
  return spawnSync(
    resolvePwshPath(),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'],
    { encoding: 'utf8' },
  ).status === 0
}

/**
 * Reuse an inherited decision or probe once and publish it for child processes.
 * @param env - environment record that owns the pinned fact.
 * @param probe - executable probe, injectable for deterministic tests.
 * @returns whether the selected PowerShell executable completed the probe.
 */
export function pinPwshTestAvailability(
  env: NodeJS.ProcessEnv = process.env,
  probe: () => boolean = probePwshTestAvailability,
): boolean {
  const raw = env[PWSH_TEST_AVAILABLE_ENV]
  if (raw !== undefined && raw !== '') {
    if (raw === '1') return true
    if (raw === '0') return false
    throw new Error(
      `${PWSH_TEST_AVAILABLE_ENV} must be '0', '1', or unset, got ${JSON.stringify(raw)}.`,
    )
  }
  const available = probe()
  env[PWSH_TEST_AVAILABLE_ENV] = available ? '1' : '0'
  return available
}
