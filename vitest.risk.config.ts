import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
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
        'lib/task-read-access.ts',
        'lib/offline-sync.ts',
      'lib/offline-retry-schedule.ts',
        'lib/sse-manager.ts',
        'lib/upload-validation.ts',
        'lib/list-invite.ts',
        'lib/ai/prompt-trust.ts',
        'lib/api-agent-auth-wrapper.ts',
      ],
      thresholds: {
        branches: 55,
        functions: 68,
        lines: 68,
        statements: 68,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})
