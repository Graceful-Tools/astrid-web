import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import os from 'os'

/**
 * Cap the fork pool below the core count.
 *
 * Vitest defaults `maxForks` to the number of CPUs, and each fork loads this
 * app's whole module graph plus a jsdom environment. On an 8-core / 24 GB
 * machine that is enough to intermittently lose whole test FILES to
 * `[vitest-pool]: Failed to start forks worker` — which vitest reports as a
 * failing file, so a green suite comes back red naming files that pass in
 * isolation. Two runs of the same commit disagreed about which ones.
 *
 * Not 1: serialising the suite trades flakiness for a runtime nobody waits
 * through, and a gate nobody waits through is a gate that gets skipped.
 *
 * Vitest 4 flattened this to `maxWorkers`; the `poolOptions.forks.maxForks`
 * spelling is Vitest 3 and no longer type-checks.
 */
const MAX_TEST_WORKERS = Math.max(2, os.cpus().length - 2)

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': '"development"',
  },
  test: {
    environment: 'jsdom',
    maxWorkers: MAX_TEST_WORKERS,
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      'packages/openclaw-astrid-channel/tests/**',
      'tests/integration/postgres-risk.test.ts',
    ],
    coverage: {
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
      include: [
        'lib/sse-*.ts',
        'hooks/use-sse-*.ts',
        'app/api/sse/**/*.ts',
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})
