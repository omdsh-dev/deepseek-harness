/**
 * The one-shot app's command-line provider: it parses the task positional,
 * output flags, and `--help`, then publishes {@link HEADLESS_STARTUP_SERVICE}.
 * The runner is an ordinary consumer whose lazy config waits for that service.
 * @module @deepseek-ai/dsh-headless/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'headless-startup'

/** Services required before the task can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the one-shot runner. */
export const HEADLESS_STARTUP_SERVICE = 'headlessStartup'

/** Product output formats accepted by the headless command. */
export const HEADLESS_OUTPUT_FORMATS = ['text', 'json'] as const

/** One final-answer presentation selected by the invocation. */
export type HeadlessOutputFormat = typeof HEADLESS_OUTPUT_FORMATS[number]

/** What the runner row reads from {@link HEADLESS_STARTUP_SERVICE}. */
export interface HeadlessStartupValues {
  /** The task text this invocation asked for. */
  task: string
  /** Whether text output uses the stable, low-noise assistive-technology presentation. */
  accessibility: boolean
  /** Whether stdout carries plain final text or one versioned JSON result. */
  outputFormat: HeadlessOutputFormat
}

/** The headless flag family, as commander parsed it. */
interface HeadlessOptions {
  accessibility?: boolean
  outputFormat: string
}

/**
 * This app's command: the task positional, its description, and its help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function headlessCommand(): Command {
  return new Command()
    .name('dsh --profile headless')
    .description('Answer one task, stream reasoning to stderr, print the final assistant message, and exit.')
    .helpOption('-h, --help', 'show this help')
    .option('--accessibility', 'use stable line-oriented status and suppress reasoning deltas')
    .option('--output-format <format>', 'stdout format: text or json', 'text')
    .argument('[task...]', 'the task text; multiple words are joined by spaces')
    .addHelpText('after', `
Examples:
  dsh --profile headless "run the tests"     answer one task and exit
  dsh --profile headless --accessibility "run the tests"
                                               use low-noise screen-reader output
  dsh --profile headless --output-format json "run the tests"
                                               print one versioned JSON result
`)
}

/**
 * Parse and provide the one-shot task as an ordinary Cordis service. The
 * command's action publishes the task; a missing or whitespace-only task is a
 * usage error, so on rejection (and on `--help`) nothing is provided.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = headlessCommand()
  program.action(() => {
    const options = program.opts<HeadlessOptions>()
    const task = program.args.join(' ')
    if (task.trim() === '') program.error('error: a task is required, for example: dsh --profile headless "run the tests"')
    if (!HEADLESS_OUTPUT_FORMATS.includes(options.outputFormat as HeadlessOutputFormat)) {
      program.error(`error: --output-format must be text or json, got ${JSON.stringify(options.outputFormat)}`)
    }
    ctx.provide(HEADLESS_STARTUP_SERVICE, {
      task,
      accessibility: options.accessibility ?? false,
      outputFormat: options.outputFormat as HeadlessOutputFormat,
    } satisfies HeadlessStartupValues)
  })
  parseCmdline(ctx, program)
}
