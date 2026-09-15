/**
 * A worker that never started is not a failing test (task d036295d).
 *
 * One afternoon's `/fixall` run spent roughly four hours on gate runs that
 * found no bug. `npm run predeploy` came back RED four times while every test
 * that ran, passed — because the machine was oversubscribed by the OTHER
 * repo's build (load 348 on 8 cores) and vitest could not boot its workers.
 * Vitest counts a file it could not START as a failing file, so the gate went
 * red naming three different sets of files across three runs, every one of
 * them green in isolation.
 *
 * The cost is not the wasted hours. It is that the same run caught a REAL
 * regression — an agent-hub test asserting `toHaveLength(4)` that a new row
 * broke — and it was nearly waved through as more contention noise. A gate
 * whose failures are usually false is a gate people stop reading.
 *
 * `describeCheckOutcome` already separates "the check failed" from "we killed
 * it at its budget", and says of the latter: "This is NOT a test failure — the
 * command never reported a result." A starved worker is the same kind of
 * non-result. These tests pin that third category, and above all pin the line
 * it must not cross: a real failure alongside starvation stays red.
 */
import { describe, it, expect } from 'vitest'
import {
  classifyVitestFailure,
  isVitestCheck,
  unstartedTestFiles,
} from '@/scripts/lib/vitest-starvation'
import { getChecks } from '@/scripts/predeploy-self-healing'

/** Verbatim from run 4 on the task. */
const STARVED_OUTPUT = `
 RUN  v4.1.11 /Users/jonparis/Documents/mycode/astrid-web

Error: [vitest-pool]: Failed to start forks worker for test files /Users/jonparis/Documents/mycode/astrid-web/tests/lib/rate-limit-async-only.test.ts
Caused by: [vitest-pool-runner]: Timeout waiting for worker to respond
Error: [vitest-pool]: Failed to start forks worker for test files /Users/jonparis/Documents/mycode/astrid-web/tests/lib/agent-queue.test.ts
Caused by: [vitest-pool-runner]: Timeout waiting for worker to respond

 Test Files  686 passed (686)
      Tests  6541 passed (6541)
`

/** Run 2's shape: exit 1, zero failures, nothing naming a file. */
const SILENT_SHORTFALL_OUTPUT = `
 RUN  v4.1.11 /Users/jonparis/Documents/mycode/astrid-web

 Test Files  685 passed (685)
      Tests  6510 passed (6510)
`

/** An ordinary red suite — the case that must keep working. */
const REAL_FAILURE_OUTPUT = `
 FAIL  tests/components/agent-hub.test.tsx > renders a row per configured agent
AssertionError: expected length 5 to be 4

 Test Files  1 failed | 687 passed (688)
      Tests  1 failed | 6603 passed (6604)
`

describe('unstartedTestFiles (task d036295d)', () => {
  it('names every file vitest could not start', () => {
    expect(unstartedTestFiles(STARVED_OUTPUT)).toEqual([
      '/Users/jonparis/Documents/mycode/astrid-web/tests/lib/rate-limit-async-only.test.ts',
      '/Users/jonparis/Documents/mycode/astrid-web/tests/lib/agent-queue.test.ts',
    ])
  })

  it('finds none in a suite that simply failed', () => {
    expect(unstartedTestFiles(REAL_FAILURE_OUTPUT)).toEqual([])
  })

  it('does not report the same file twice', () => {
    expect(unstartedTestFiles(`${STARVED_OUTPUT}\n${STARVED_OUTPUT}`)).toHaveLength(2)
  })
})

describe('classifyVitestFailure (task d036295d)', () => {
  it('calls a named worker failure starvation, and offers the files to re-run', () => {
    const verdict = classifyVitestFailure(STARVED_OUTPUT, { passed: 6541, failed: 0, skipped: 0, total: 6541 })

    expect(verdict.kind).toBe('starved')
    expect(verdict.kind === 'starved' && verdict.unstartedFiles).toHaveLength(2)
  })

  it('calls a non-zero exit with zero failing tests starvation too', () => {
    // Run 2: 6510 passed, nothing failed, still exit 1, six tests missing.
    // Nothing names a file, so there is nothing to re-run — but it is still
    // not a test failure, and must not be reported as one.
    const verdict = classifyVitestFailure(SILENT_SHORTFALL_OUTPUT, {
      passed: 6510,
      failed: 0,
      skipped: 0,
      total: 6510,
    })

    expect(verdict.kind).toBe('starved')
    expect(verdict.kind === 'starved' && verdict.unstartedFiles).toEqual([])
  })

  it('REFUSES to excuse a real failure, even when workers also starved', () => {
    // The line this must never cross. On the run that produced this task the
    // gate caught a genuine regression while contention was raging; if
    // starvation could mask it, this whole change would be a net loss.
    const mixed = `${STARVED_OUTPUT}\n${REAL_FAILURE_OUTPUT}`
    const verdict = classifyVitestFailure(mixed, { passed: 6603, failed: 1, skipped: 0, total: 6604 })

    expect(verdict.kind).toBe('tests-failed')
  })

  it('treats a plain red suite as a plain red suite', () => {
    const verdict = classifyVitestFailure(REAL_FAILURE_OUTPUT, {
      passed: 6603,
      failed: 1,
      skipped: 0,
      total: 6604,
    })

    expect(verdict.kind).toBe('tests-failed')
  })

  it('does not guess when vitest printed no summary at all', () => {
    // A killed or crashed run has no stats. Calling that starvation would
    // excuse a genuine crash; it is reported as a failure, as it was before.
    const verdict = classifyVitestFailure('Segmentation fault', undefined)

    expect(verdict.kind).toBe('tests-failed')
  })

  it('says plainly that this is not a test failure', () => {
    const verdict = classifyVitestFailure(STARVED_OUTPUT, { passed: 6541, failed: 0, skipped: 0, total: 6541 })

    expect(verdict.kind === 'starved' && verdict.summary).toContain('NOT a test failure')
  })
})

/**
 * The classification is useless if it never runs. `isVitestCheck` matches on
 * the check's NAME, so renaming the check in `getChecks()` would silently
 * detach the starvation branch and the gate would go back to reporting
 * unstarted files as failures — with nothing failing to say so.
 */
describe('the starvation branch is actually wired to the real check (task d036295d)', () => {
  it('recognises the vitest check the gate really registers', () => {
    const matched = getChecks().filter(check => isVitestCheck(check.name))

    expect(matched.map(check => check.name)).toEqual(['Unit Tests (Vitest)'])
  })

  it('claims no other check, so tsc or eslint can never be excused as starved', () => {
    const others = getChecks().filter(check => !isVitestCheck(check.name))

    expect(others.length).toBeGreaterThan(5)
    for (const check of others) {
      expect(isVitestCheck(check.name), check.name).toBe(false)
    }
  })
})
