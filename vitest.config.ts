import { defineConfig, mergeConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { sharedTestConfig } from './vitest.shared'

/**
 * The main suite. Everything shared with the risk and postgres configs lives in
 * vitest.shared.ts (task f5022e72) — what stays here is what makes this config
 * the main one: jsdom, the React plugin, and the coverage gate over the
 * application.
 */
export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    plugins: [react()],
    define: {
      'process.env.NODE_ENV': '"development"',
    },
    test: {
      environment: 'jsdom',
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
         * Measured 2026-09-09 over the includes above: lines 47.10,
         * statements 46.89, functions 50.46, branches 43.36. The old 80% was
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
         */
        thresholds: {
          lines: 46,
          statements: 46,
          functions: 49,
          branches: 42,
        },
      },
    },
  })
)
