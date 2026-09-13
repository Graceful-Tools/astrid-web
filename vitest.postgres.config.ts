import { defineConfig } from 'vitest/config'
import { POSTGRES_ONLY_TEST, sharedResolve, sharedTestConfig } from './vitest.shared'

/**
 * The one test that needs a real Postgres.
 *
 * Shares the alias and worker settings with the other two (task f5022e72) but
 * overrides almost everything else, and each override is load-bearing: `node`
 * because there is no DOM, one worker with no file parallelism because the
 * tests share a database, longer timeouts because a real connection is slower
 * than a mock, and NO shared setup file — tests/setup.ts mocks Prisma, which is
 * precisely what this suite exists not to do.
 *
 * Composed by SPREADING the shared base rather than `mergeConfig`, and that is
 * the point. mergeConfig CONCATENATES arrays: the `exclude` below, written as
 * an override, was appended to SHARED_EXCLUDE — which lists this suite's only
 * test on purpose, so every other config skips it. The tier then excluded the
 * file it includes, collected nothing, and exited 1 with `No test files found`,
 * failing the authenticated-critical E2E job on every branch and on main.
 *
 * A spread makes an override an override. Guarded by
 * tests/rules/postgres-config-collects-its-suite.test.ts.
 */
export default defineConfig({
  ...sharedTestConfig,
  test: {
    ...sharedTestConfig.test,
    environment: 'node',
    setupFiles: [],
    include: [POSTGRES_ONLY_TEST],
    // Genuinely the whole exclude list for this tier — see the note above about
    // why this cannot go through mergeConfig.
    exclude: ['**/node_modules/**'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: sharedResolve,
})
