import { defineConfig, mergeConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { SHARED_EXCLUDE, sharedTestConfig } from './vitest.shared'

/**
 * Tests that need no DOM (ADEV-295): they scan the repo or spawn scripts, so they
 * run in the node environment with tests/setup.node.ts instead of paying for
 * jsdom, jest-dom, fake-indexeddb and the global mocks in every file.
 * Everything else stays in the `dom` project with the full setup.
 */
const NODE_PROJECT_INCLUDE = [
  'tests/rules/**/*.test.ts',
  'tests/scripts/**/*.test.ts',
  'tests/sdk/**/*.test.ts',
  'tests/mcp/**/*.test.ts',
  'tests/workflows/**/*.test.ts',
  'tests/contracts/**/*.test.ts',
  'tests/brands/**/*.test.ts',
  'tests/utils/**/*.test.ts',
  'tests/*.test.ts',
]

/**
 * Tests that render or touch the DOM keep jsdom and the full setup.
 * Anything in neither list (tests/lib, api, services, ...) runs in the node
 * environment with the full setup, so it still gets the global mocks.
 */
const DOM_PROJECT_INCLUDE = [
  'tests/components/**/*.test.{ts,tsx}',
  'tests/hooks/**/*.test.{ts,tsx}',
  'tests/pages/**/*.test.{ts,tsx}',
  'tests/styles/**/*.test.{ts,tsx}',
  'tests/i18n/**/*.test.{ts,tsx}',
  'tests/**/*.test.tsx',
  // tests/lib files that reach for `document`, `window` or IndexedDB.
  'tests/lib/{core-rules-markdown-parity,markdown-parity,offline-sync,markdown-render,markdown-references}.test.ts',
  'tests/lib/{cross-tab-sync,comment-formats,client-reminder-sync,markdown-follow-ios}.test.ts',
  'tests/lib/{tradeoff-even-grid-awtd-1536,offline-retry-backoff,my-tasks-scope,favorites-sse-isolation}.test.ts',
  'tests/lib/{markdown-tradeoff-grid-block-awtd-1626,core-rules-rows-awtd-1663,decisions-numbered-awtd-1533}.test.ts',
  'tests/lib/{task-identifier-links,sse-manager}.test.ts',
]

/**
 * The main suite. Everything shared with the risk and postgres configs lives in
 * vitest.shared.ts (task f5022e72) — what stays here is what makes this config
 * the main one: jsdom, the React plugin, and the coverage gate over the
 * application.
 */
/**
 * Every main-suite run uses the same timezone: UTC, as CI always has (2026-11-08).
 *
 * The suite used to take the machine's zone. It passed in exactly two: UTC (CI)
 * and Pacific (Jon's Mac). Run in Berlin or Kolkata, 57 tests failed; in
 * Auckland, 73 — every one a test assuming the zone it was written in (a "today"
 * built from the UTC date, a fixed list of expected clock times). One of them was
 * hiding a product bug, the daily digest's server-zone dates (AWTD-1545). So a scheduled runner, a Mac or a contributor anywhere else got a red
 * predeploy that said nothing about their change.
 *
 * Set here, before any worker starts, so every worker inherits it. Only in the
 * MAIN suite's config, not vitest.shared.ts: the PostgreSQL tier runs in
 * America/Los_Angeles on purpose (e2e-tests.yml, AWTD-1423), so a driver that
 * shifts timestamps by the process offset fails its round trip.
 * Zone behaviour is tested on purpose instead, by tests that set `process.env.TZ`
 * themselves (tests/lib/date-dst-day-difference.test.ts,
 * tests/lib/all-day-dates-east-of-utc.test.ts). `ASTRID_TEST_TZ` runs the suite
 * in another zone, to find the next test that only passes in UTC:
 *   ASTRID_TEST_TZ=Pacific/Auckland npx vitest run
 */
process.env.TZ = process.env.ASTRID_TEST_TZ || 'UTC'

export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    plugins: [react()],
    define: {
      'process.env.NODE_ENV': '"development"',
    },
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'dom',
            environment: 'jsdom',
            include: DOM_PROJECT_INCLUDE,
          },
        },
        {
          extends: true,
          test: {
            name: 'node-mocked',
            environment: 'node',
            exclude: [...SHARED_EXCLUDE, ...NODE_PROJECT_INCLUDE, ...DOM_PROJECT_INCLUDE],
          },
        },
        {
          extends: true,
          test: {
            name: 'node',
            environment: 'node',
            setupFiles: ['./tests/setup.node.ts'],
            include: NODE_PROJECT_INCLUDE,
          },
        },
      ],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        exclude: [
          'node_modules/',
          'tests/',
          'coverage/',
          '.next/',
          'scripts/',
          'docs/',
          'mcp/',
          '*.config.*',
          'app/api/webhooks/',
          'app/api/auth/',
          'app/api/cron/',
          'app/api/debug/',
        ],
        /**
         * The application, not a corner of it.
         *
         * This was `['lib/sse-*.ts', 'hooks/use-sse-*.ts', 'app/api/sse/**']`
         * under an 80% threshold, so "80% coverage" was a statement about the
         * SSE subsystem while ~36k lines of app/api and ~58k of lib were
         * measured by nothing at all (task f5022e72).
         */
        include: [
          'app/api/**/*.ts',
          'lib/**/*.ts',
          'hooks/**/*.ts',
        ],
        /**
         * A RATCHET, pinned to what the codebase actually does.
         *
         * Measured 2026-11-26 (ADEV-292) over the includes above: lines 68.11,
         * statements 67.68, functions 71.68, branches 63.68 (was 47.10, 46.89,
         * 50.46, 43.36 on 2026-09-09). The old 80% was
         * reachable only because it described three globs; over the real
         * application it would fail on the first run, and an unreachable gate
         * gets deleted rather than met.
         *
         * Each floor sits about a point under its measurement. Coverage across
         * 630 files and parallel workers is not bit-identical run to run, and a
         * gate that goes red on a rounding wobble is one people start passing
         * --no-coverage to.
         *
         * RAISE these as coverage improves. That is the whole mechanism: the
         * number cannot silently shrink, and locking in a gain is one edit.
         *
         * Enforced in CI, not in local predeploy: unit-tests.yml runs
         * `npm run test:coverage`, a required check. A coverage pass over the
         * whole suite is too slow for predeploy.
         */
        thresholds: {
          lines: 67,
          statements: 66.5,
          functions: 70,
          branches: 62.5,
        },
      },
    },
  })
)
