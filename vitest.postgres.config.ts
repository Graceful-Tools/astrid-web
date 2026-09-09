import { defineConfig, mergeConfig } from 'vitest/config'
import { sharedTestConfig } from './vitest.shared'

/**
 * The one test that needs a real Postgres.
 *
 * Shares the alias with the other two (task f5022e72) but overrides almost
 * everything else, and each override is load-bearing: `node` because there is
 * no DOM, one worker with no file parallelism because the tests share a
 * database, longer timeouts because a real connection is slower than a mock,
 * and NO shared setup file — tests/setup.ts mocks Prisma, which is precisely
 * what this suite exists not to do.
 */
export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    test: {
      environment: 'node',
      setupFiles: [],
      include: ['tests/integration/postgres-risk.test.ts'],
      // The shared exclude lists this file, since every other config must skip
      // it. Here it is the entire suite.
      exclude: ['**/node_modules/**'],
      fileParallelism: false,
      maxWorkers: 1,
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  })
)
