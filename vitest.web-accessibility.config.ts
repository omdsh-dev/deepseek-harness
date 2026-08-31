import { defineConfig } from 'vitest/config'
import webConfig from './vitest.web.config.ts'

// Focused real-browser accessibility contracts stay independent from the
// snapshot inventory so each engine reports a separate reproducible verdict.
export default defineConfig({
  ...webConfig,
  test: {
    ...webConfig.test,
    include: ['apps/web/tests/**/*.accessibility.ts'],
    fileParallelism: false,
  },
})
