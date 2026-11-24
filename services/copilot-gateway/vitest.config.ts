import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * The gateway's own suite. Runs from this directory with the package's vitest,
 * or from the repo root (`npm run test:copilot-gateway`, a predeploy gate) with
 * the root's: the tests fake the SDK client, so neither needs the runtime.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
