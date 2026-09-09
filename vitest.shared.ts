import path from 'path'
import os from 'os'
import { defineConfig } from 'vitest/config'

/**
 * What all three vitest configs agree about (task f5022e72).
 *
 * There were three configs and no shared base: `vitest.config.ts`,
 * `vitest.risk.config.ts` and `vitest.postgres.config.ts` each spelled out the
 * `@` alias, the setup file and their own timeouts. Three copies of the same
 * settings is three chances for a run to behave differently from the run that
 * gates it — and the risk config, which exists to hold a security surface to a
 * coverage floor, is the one you least want quietly diverging.
 *
 * What is NOT here: `include`, `coverage` and `environment`. Those are the
 * point of each config, and a base that guessed at them would be a fourth
 * opinion rather than a shared one.
 */

/**
 * Cap the fork pool below the core count.
 *
 * Vitest defaults `maxWorkers` to the number of CPUs, and each worker loads
 * this app's whole module graph plus a jsdom environment. On an 8-core / 24 GB
 * machine that is enough to intermittently lose whole test FILES to
 * `[vitest-pool]: Failed to start forks worker` — which vitest reports as a
 * failing file, so a green suite comes back red naming files that pass in
 * isolation. Two runs of the same commit disagreed about which ones.
 *
 * Half the cores, not all-but-two. Vitest gives a worker a hardcoded 60s to
 * report "started" (START_TIMEOUT in its bundle — there is no config knob), and
 * a worker that has to load this module graph while the box is oversubscribed
 * can genuinely miss that. Fewer workers contending to boot is the only lever
 * the repo has over it.
 *
 * This machine also hosts self-hosted GitHub Actions runners and an iOS
 * simulator, so "idle" is not a safe assumption: a scheduled workflow doing an
 * npm install has driven load past 150 on 8 cores mid-run.
 *
 * Not 1: serialising the suite trades flakiness for a runtime nobody waits
 * through, and a gate nobody waits through is a gate that gets skipped.
 */
export const MAX_TEST_WORKERS = Math.max(2, Math.floor(os.cpus().length / 2))

/**
 * Headroom against starvation, not a licence for slow tests.
 *
 * Vitest's 5s default is fine for what these tests DO — the repo-scanning rule
 * tests run in tens of milliseconds in isolation. It is not fine for the
 * machine they run on: `tests/rules/v1-envelope-callsites.test.ts` measures
 * 36ms alone and still timed out at 5000ms during a full run, a 140x blowup
 * caused entirely by external load.
 *
 * 15s keeps a genuine hang cheap to detect while surviving a load spike. A test
 * that legitimately needs seconds should say so at its own describe — see
 * tests/scripts/check-reuse-rules.test.ts — rather than lean on this.
 */
export const TEST_TIMEOUT_MS = 15_000

/** Paths that are never test files, whichever config is running. */
export const SHARED_EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/e2e/**',
  '**/.{idea,git,cache,output,temp}/**',
  '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
  'packages/openclaw-astrid-channel/tests/**',
  // Needs a real Postgres; vitest.postgres.config.ts runs it on its own.
  'tests/integration/postgres-risk.test.ts',
]

/** The `@/…` alias every config resolves identically. */
export const sharedResolve = {
  alias: {
    '@': path.resolve(__dirname, './'),
  },
}

/** The base every config merges. */
export const sharedTestConfig = defineConfig({
  test: {
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    maxWorkers: MAX_TEST_WORKERS,
    testTimeout: TEST_TIMEOUT_MS,
    exclude: SHARED_EXCLUDE,
  },
  resolve: sharedResolve,
})
