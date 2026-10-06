/** External browser and model fixtures around the real provider, Worker, and RPC. */
import { registerHooks, syncBuiltinESMExports } from 'node:module'
import { readFileSync } from 'node:fs'
import workerThreads from 'node:worker_threads'
import ts from 'typescript'

export const name = 'browser-use-stagehand-native-fixture'
export const inject = ['browserUse', 'agents', 'tools', 'systemPrompt']

const packageRoot = new URL('../../../packages/experimental/browser-use-stagehand-native/', import.meta.url)
const sdkFixture = new URL('tests/fixtures/stagehand.ts', packageRoot).href
const chromiumFixture = new URL('tests/fixtures/chromium.ts', packageRoot).href

/** Install external browser mocks in one real Node isolate. */
export function installExternalBrowserHooks() {
  // Resolve fixtures to module sources without a synchronous load hook: mixing
  // that hook with the asynchronous tsx loader breaks real CommonJS dependencies.
  const sources = new Map([sdkFixture, chromiumFixture].map(url => [url,
    `data:text/javascript,${encodeURIComponent(ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText)}`,
  ]))
  const parents = new Map([...sources].map(([url, source]) => [source, url]))
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const fixture = sources.get(specifier === '@puppeteer/browsers' ? chromiumFixture : specifier)
      if (fixture !== undefined) return { url: fixture, shortCircuit: true }
      const parentURL = parents.get(context.parentURL)
      if (parentURL !== undefined) context = { ...context, parentURL }
      const actual = nextResolve(specifier, context)
      if (specifier !== '@browserbasehq/stagehand') {
        // Relative fixture imports must share the same transpiled module identity.
        const source = sources.get(actual.url)
        return source === undefined ? actual : { url: source, shortCircuit: true }
      }
      const proxy = `export * from ${JSON.stringify(sources.get(sdkFixture))}; export { StagehandClientCreateConfigSchema } from ${JSON.stringify(actual.url)};`
      return { url: `data:text/javascript,${encodeURIComponent(proxy)}`, shortCircuit: true }
    },
  })
  return () => hooks.deregister()
}

/**
 * Prepend external SDK fixtures only to the production Stagehand Worker entry.
 * @param {string | URL} filename - Original Worker entry from the real provider.
 * @returns {string | URL} The original entry or a fixture-prefixed bootstrap.
 */
export function wrapStagehandWorkerEntry(filename) {
  const sourceWorker = new URL('src/worker.ts', packageRoot).href
  const builtWorker = new URL('lib/worker.js', packageRoot).href
  const stagehand = filename instanceof URL && (filename.href === builtWorker
    || filename.protocol === 'data:' && filename.href.includes(encodeURIComponent(sourceWorker)))
  if (!stagehand) return filename
  const bootstrap = `import { installExternalBrowserHooks } from ${JSON.stringify(import.meta.url)}; installExternalBrowserHooks(); await import(${JSON.stringify(filename.href)});`
  return new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`)
}

/** Keep the real Stagehand Worker while installing its external SDK fixture before entry. */
export function installBrowserFixtureHooks() {
  const removeHooks = installExternalBrowserHooks()
  const NativeWorker = workerThreads.Worker
  class BrowserFixtureWorker extends NativeWorker {
    constructor(filename, options) {
      super(wrapStagehandWorkerEntry(filename), options)
    }
  }
  workerThreads.Worker = BrowserFixtureWorker
  syncBuiltinESMExports()
  return () => {
    workerThreads.Worker = NativeWorker
    syncBuiltinESMExports()
    removeHooks()
  }
}

export async function apply(ctx) {
  ctx.effect(installBrowserFixtureHooks, 'browser-use-stagehand-native-fixture.module')
  const provider = await import('@deepseek-ai/dsh-experimental-browser-use-stagehand-native')
  await ctx.plugin(provider, {
    mode: 'launch', model: { modelName: 'openai/gpt-5.4-mini', apiKey: 'snapshot-placeholder' },
  })
}
