#!/usr/bin/env node

import fs from 'node:fs'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

/** Command-line dispatch for PR policy checks and Issue lifecycle events. */
import { runLifecycle } from './lifecycle.mjs'
import { runPullRequestCheck, runPullRequestPreflight } from './pull-request.mjs'
import config from './config.json' with { type: 'json' }

// Read-only PR policy should follow the repository running the workflow. This
// preserves the checked-in upstream defaults for local use while making forks
// validate their own pull requests instead of querying the upstream PR number.
const runtimeRepository = process.env.GITHUB_REPOSITORY?.split('/')
if (runtimeRepository?.length === 2 && runtimeRepository.every(Boolean)) {
  config.organization = runtimeRepository[0]
  config.repository = runtimeRepository[1]
}

function readEvent() {
  if (!process.env.GITHUB_EVENT_PATH) throw new Error('GITHUB_EVENT_PATH 未设置')
  return JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
}

async function main(argv) {
  const [command] = argv
  if (command === 'pr-preflight') await runPullRequestPreflight(readEvent())
  else if (command === 'pr') await runPullRequestCheck(readEvent())
  else if (command === 'lifecycle') await runLifecycle(process.env.GITHUB_EVENT_NAME, readEvent())
  else throw new Error('用法：policy.mjs pr-preflight|pr|lifecycle')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
