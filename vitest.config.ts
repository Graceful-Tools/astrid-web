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
 * Half the cores, not all-but-two. Vitest gives a worker a hardcoded 60s to
 * report "started" (START_TIMEOUT in its bundle — there is no config knob), and
 * a fork that has to load this module graph while the box is oversubscribed can
 * genuinely miss that. When it does, vitest reports "Failed to start forks
 * worker" and counts the file as FAILING, so the gate goes red naming files
 * that pass in isolation. Fewer forks contending to boot is the only lever the
 * repo has over that.
 *
 * This machine also hosts self-hosted GitHub Actions runners and an iOS
 * simulator, so "idle" is not a safe assumption: a scheduled workflow doing an
 * npm install has driven load past 150 on 8 cores mid-run.
 *
 * Not 1: serialising the suite trades flakiness for a runtime nobody waits
 * through, and a gate nobody waits through is a gate that gets skipped.
 *
 * Vitest 4 flattened this to `maxWorkers`; the `poolOptions.forks.maxForks`
 * spelling is Vitest 3 and no longer type-checks.
 */
const MAX_TEST_WORKERS = Math.max(2, Math.floor(os.cpus().length / 2))

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': '"development"',
  },
  test: {
    environment: 'jsdom',
    maxWorkers: MAX_TEST_WORKERS,
    /*
     * Headroom against starvation, not a licence for slow tests.
     *
     * Vitest's 5s default is fine for what these tests DO — the repo-scanning
     * rule tests run in tens of milliseconds in isolation. It is not fine for
     * the machine they run on: `tests/rules/v1-envelope-callsites.test.ts`
     * measures 36ms alone and still timed out at 5000ms during a full run,
     * a 140x blowup caused entirely by external load (this box also hosts
     * self-hosted CI runners and an iOS simulator).
     *
     * 15s keeps a genuine hang cheap to detect while surviving a load spike.
     * A test that legitimately needs seconds should say so at its own describe
     * — see tests/scripts/check-reuse-rules.test.ts — rather than lean on this.
     */
    testTimeout: 15_000,
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
