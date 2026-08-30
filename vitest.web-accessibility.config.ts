import { defineConfig } from 'vitest/config'
import webConfig from './vitest.web.config.ts'

// Focused real-browser accessibility modes stay independent from the snapshot
// inventory so each engine reports a separate, reproducible release verdict.
export default defineConfig({
  ...webConfig,
  test: {
    ...webConfig.test,
    include: ['apps/web/tests/**/*.accessibility.ts'],
    fileParallelism: false,
  },
})
