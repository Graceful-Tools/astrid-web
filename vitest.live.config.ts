import { defineConfig } from 'vitest/config'
import { LIVE_TESTS, sharedResolve, sharedTestConfig } from './vitest.shared'

/**
 * Live tests: real GitHub, a real (throwaway, localhost) Postgres. Gated on
 * secrets in each test and never part of predeploy (spec §14.2, AWTD-1154).
 *
 *   GITHUB_PROJECTS_LIVE=1 TEST_DATABASE_URL=postgresql://…/…test… \
 *     npm run test:live:github-projects
 *
 * Same shape as vitest.postgres.config.ts, and for the same reasons: a spread
 * (not mergeConfig) so `exclude` overrides rather than appends, no shared
 * setup file (it mocks Prisma), one worker against one database.
 */
export default defineConfig({
  ...sharedTestConfig,
  test: {
    ...sharedTestConfig.test,
    environment: 'node',
    setupFiles: [],
    include: [LIVE_TESTS],
    exclude: ['**/node_modules/**'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
  resolve: sharedResolve,
})
