/**
 * RULE — the Postgres tier must actually collect the test it exists to run.
 *
 * `vitest.postgres.config.ts` runs exactly one file, and it builds itself with
 * `mergeConfig(sharedTestConfig, …)`. That is the trap: **vitest's mergeConfig
 * CONCATENATES arrays, it does not replace them.** So the config's
 * `exclude: ['**\/node_modules/**']` — written as an override, and commented as
 * one ("Here it is the entire suite") — was appended to `SHARED_EXCLUDE`
 * instead. And `SHARED_EXCLUDE` deliberately lists
 * `tests/integration/postgres-risk.test.ts`, because every OTHER config must
 * skip it.
 *
 * Net effect: the suite excluded its own only test. Vitest found nothing to run
 * and exited 1 with `No test files found`, which failed the E2E workflow's
 * `authenticated-critical` job on every branch and on `main` — a red gate that
 * named no test, so it read as infrastructure flake rather than a config bug.
 *
 * The failure mode this guards is worse than a red gate, though: had the
 * `exit 1` not been there, an empty run is a PASSING run. The security surface
 * `postgres-risk.test.ts` covers would have silently stopped being checked —
 * the same rot `risk-config-paths-exist.test.ts` exists to catch, arriving by a
 * different door.
 *
 * So this asserts the property, not the spelling: whatever the two configs say,
 * the file the Postgres tier includes must survive its own exclude list.
 */

import { describe, it, expect } from 'vitest'
import { minimatch } from 'minimatch'
import postgresConfig from '@/vitest.postgres.config'
import { POSTGRES_ONLY_TEST, SHARED_EXCLUDE } from '@/vitest.shared'

/** True when any of `patterns` would keep vitest from collecting `file`. */
const excludedBy = (patterns: string[], file: string) =>
  patterns.some(pattern => minimatch(file, pattern))

const test = (postgresConfig as { test?: Record<string, unknown> }).test ?? {}
const include = (test.include ?? []) as string[]
const exclude = (test.exclude ?? []) as string[]

describe('the Postgres tier collects its own suite', () => {
  it('includes exactly the one file that needs a real database', () => {
    expect(include).toEqual(['tests/integration/postgres-risk.test.ts'])
  })

  it('does not exclude the file it includes', () => {
    const swallowed = include.filter(file => excludedBy(exclude, file))

    expect(
      swallowed,
      'vitest mergeConfig CONCATENATES arrays, so an `exclude` written here as ' +
        'an override is appended to SHARED_EXCLUDE — which lists the Postgres ' +
        'test on purpose. The result collects nothing: `No test files found`, ' +
        'exit 1, and the authenticated-critical E2E job red on every branch. ' +
        'Set the exclude explicitly rather than relying on mergeConfig to replace it.'
    ).toEqual([])
  })

  it('still skips node_modules, so the override did not simply drop the floor', () => {
    expect(excludedBy(exclude, 'node_modules/some-package/tests/thing.test.ts')).toBe(true)
  })

  it('and every OTHER config still skips it — the exclusion was not deleted to fix this', () => {
    // The obvious wrong fix is to drop the path from SHARED_EXCLUDE. That would
    // green this file while handing the mocked-Prisma suites a test that opens
    // a real database connection.
    expect(excludedBy(SHARED_EXCLUDE, POSTGRES_ONLY_TEST)).toBe(true)
  })
})
