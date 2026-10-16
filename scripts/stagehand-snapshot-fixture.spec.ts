/** The built snapshot's external fixtures must also load without a TypeScript loader. */

import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const packageRoot = new URL('../packages/experimental/browser-use-stagehand-native/', import.meta.url)
const hooks = new URL('../snapshots/session/browser-use-stagehand-native/native-fixture.mjs', import.meta.url)
const sdkFixture = new URL('tests/fixtures/stagehand.ts', packageRoot)

it('shares the transpiled SDK fixture with relative Chromium imports in plain Node and restores resolution', async (context) => {
  const source = `
    import assert from 'node:assert/strict';
    import { once } from 'node:events';
    const actualSDK = await import('@browserbasehq/stagehand');
    const actualSDKURL = import.meta.resolve('@browserbasehq/stagehand');
    const actualChromiumURL = import.meta.resolve('@puppeteer/browsers');
    const { installExternalBrowserHooks } = await import(${JSON.stringify(hooks.href)});
    const dispose = installExternalBrowserHooks();
    try {
      const chromium = await import('@puppeteer/browsers');
      const sdk = await import('@browserbasehq/stagehand');
      const directFixture = await import(${JSON.stringify(sdkFixture.href)});
      assert.equal(sdk.StagehandClientCreateConfigSchema, actualSDK.StagehandClientCreateConfigSchema);
      assert.equal(sdk.fixture, directFixture.fixture);
      const process = chromium.launch({ executablePath: '/fixture/chromium', args: [] });
      const endpoint = await process.waitForLineOutput();
      const browser = sdk.fixture.connections.get(endpoint);
      assert.ok(browser instanceof sdk.FixtureBrowser);
      assert.equal(sdk.fixture.browsers[0], browser);
      const closed = once(process.nodeProcess, 'close');
      process.kill();
      await closed;
      assert.equal(browser.closed, true);
      console.log('fixture-shared');
    } finally {
      dispose();
    }
    assert.equal(import.meta.resolve('@browserbasehq/stagehand'), actualSDKURL);
    assert.equal(import.meta.resolve('@puppeteer/browsers'), actualChromiumURL);
    console.log('hooks-restored');
  `
  const controller = new AbortController()
  const child = execFileAsync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: fileURLToPath(packageRoot),
    // An inherited loader would mask the built-runtime strip-only regression.
    env: { ...process.env, NODE_OPTIONS: '' },
    signal: controller.signal,
  })
  context.onTestFinished(async () => {
    controller.abort()
    await Promise.allSettled([child])
  })
  const { stdout, stderr } = await child
  expect(stderr).toBe('')
  expect(stdout).toBe('fixture-shared\nhooks-restored\n')
})
