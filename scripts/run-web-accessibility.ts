/** Run the focused assembled-app accessibility suite once per selected browser engine. */

import { spawn } from 'node:child_process'
import { pnpmInvocation } from './pnpm-invocation.ts'

const supported = ['chromium', 'firefox', 'webkit'] as const
type BrowserName = typeof supported[number]
const selected = parseBrowsers(process.env.DSH_A11Y_BROWSERS)
const invocation = pnpmInvocation(['exec', 'vitest', 'run', '--config', 'vitest.web-accessibility.config.ts'])

for (const browser of selected) {
  const status = await run(invocation.command, invocation.args, browser)
  if (status !== 0) {
    process.exitCode = status
    break
  }
}

function parseBrowsers(raw: string | undefined): BrowserName[] {
  const values = (raw ?? supported.join(',')).split(',')
  if (values.length === 0 || values.some(value => !supported.includes(value as BrowserName))) {
    throw new Error(`DSH_A11Y_BROWSERS must be a comma-separated subset of ${supported.join(',')}; got ${JSON.stringify(raw)}`)
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`DSH_A11Y_BROWSERS must not contain duplicates; got ${JSON.stringify(raw)}`)
  }
  return values as BrowserName[]
}

function run(command: string, args: string[], browser: BrowserName): Promise<number> {
  return new Promise((resolveRun, reject) => {
    console.log(`Accessibility browser gate: ${browser}`)
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        DSH_A11Y_BROWSER: browser,
        DSH_SNAPSHOT: process.env.DSH_SNAPSHOT ?? 'replay',
      },
    })
    child.once('error', reject)
    child.once('exit', (exitCode, signalCode) => {
      if (signalCode !== null) {
        console.error(`${browser} accessibility gate terminated by ${signalCode}`)
        resolveRun(1)
        return
      }
      resolveRun(exitCode ?? 1)
    })
  })
}
