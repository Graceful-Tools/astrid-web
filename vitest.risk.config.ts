import { defineConfig, mergeConfig } from 'vitest/config'
import { sharedTestConfig } from './vitest.shared'

/**
 * The risk surface, held to its own coverage floor.
 *
 * The alias, setup file, worker cap and timeouts come from vitest.shared.ts
 * (task f5022e72) — they were a third hand-maintained copy, and this is the
 * config you least want quietly diverging from the one that gates the suite.
 *
 * The include list below stays hand-maintained on purpose: it is the DEFINITION
 * of the risk surface, not an artefact. What it must not do is rot silently, so
 * tests/rules/risk-config-paths-exist.test.ts fails when a path in it stops
 * matching a file — the failure mode the filing describes, where renaming a
 * test drops it out of the gate instead of breaking it.
 */
export default mergeConfig(
  sharedTestConfig,
  defineConfig({
  test: {
    environment: 'jsdom',
    include: [
      'tests/lib/api-auth-wrapper.test.ts',
      'tests/lib/list-permissions.test.ts',
      'tests/lib/task-read-access.test.ts',
      'tests/lib/api-offline-queue-v1-urls.test.ts',
      'tests/lib/offline-sync.test.ts',
      // The replay backoff is part of the offline risk surface: without this the
      // new paths in lib/offline-sync.ts counted against the coverage threshold
      // while the tests that exercise them sat outside this hand-maintained
      // list (task b8b21855; the list itself is task f5022e72).
      'tests/lib/offline-retry-backoff.test.ts',
      'tests/lib/sse-manager.test.ts',
      'tests/lib/upload-validation.test.ts',
      'tests/lib/list-invite.test.ts',
      'tests/lib/assistant-prompt-trust.test.ts',
      'tests/lib/api-agent-auth-wrapper.test.ts',
      'tests/api/legacy-v1-risk-parity.test.ts',
      'tests/api/v1-lists-invitations.test.ts',
      'tests/api/v1-secure-files-methods.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'lib/api-auth-wrapper.ts',
        'lib/list-permissions.ts',
        // Was 'lib/task-read-access.ts', which does not exist and has not for
        // as long as this list has said so. requireTaskAccess and
        // requireTaskReadAccess live in api-auth-middleware, so the risk gate
        // was holding a missing file to a threshold — met trivially — while the
        // module actually carrying those checks went unmeasured. Found by
        // tests/rules/risk-config-paths-exist.test.ts on its first run.
        'lib/api-auth-middleware.ts',
        'lib/offline-sync.ts',
      'lib/offline-retry-schedule.ts',
        'lib/sse-manager.ts',
        'lib/upload-validation.ts',
        'lib/list-invite.ts',
        'lib/ai/prompt-trust.ts',
        'lib/api-agent-auth-wrapper.ts',
      ],
      /**
       * Lowered 68/55 → 62/50 on 2026-09-09, and the number went DOWN because
       * the measurement got honest, not because coverage did (task f5022e72).
       *
       * The list above named `lib/task-read-access.ts`, which does not exist.
       * A threshold over a missing file is met trivially, so the old 68% was
       * computed over nine files while the module that actually holds
       * requireTaskAccess / requireTaskReadAccess — api-auth-middleware, at
       * 16.4% — was not in the gate at all.
       *
       * These are the real figures for the ten files now measured. Raising them
       * means testing api-auth-middleware, which is filed separately rather
       * than pretended about here.
       */
      thresholds: {
        branches: 50,
        functions: 64,
        lines: 62,
        statements: 62,
      },
    },
  },
  })
)
