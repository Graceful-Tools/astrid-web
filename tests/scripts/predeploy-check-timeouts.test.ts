/**
 * The predeploy gate reported a check as FAILED when it had actually been
 * KILLED.
 *
 * Every check ran under one hardcoded `execSync` timeout of 300s. The unit
 * suite takes about 870s on a developer machine, so the Vitest gate could not
 * pass no matter what was in the diff — and because a timeout kill was caught
 * by the same `catch` as a genuine non-zero exit, it was reported as
 * "❌ Unit Tests (Vitest) failed" with no hint that nothing had failed.
 *
 * The auto-filed task made it worse rather than better: a killed vitest never
 * prints its summary, so `formatFailureOutput` kept a tail of MaxListeners
 * warnings and the report named no failing test. The only way to find out was
 * to run the suite by hand and discover it was green — which is an hour spent
 * proving a negative, every time.
 *
 * So this pins two things: the budgets are real, and a kill says it is a kill.
 */

import { describe, it, expect } from 'vitest'
import {
  getChecks,
  isTimeoutKill,
  DEFAULT_CHECK_TIMEOUT_MS,
  describeCheckOutcome,
} from '../../scripts/predeploy-self-healing'

/** An error shaped the way Node's execSync rejects on `timeout`. */
const timeoutError = () =>
  Object.assign(new Error('Command failed'), {
    killed: true,
    signal: 'SIGTERM',
    status: null,
    stdout: 'partial output',
    stderr: '',
  })

/** An ordinary failing command: exited on its own, with a status. */
const exitError = (status = 1) =>
  Object.assign(new Error('Command failed'), {
    killed: false,
    signal: null,
    status,
    stdout: 'Tests  3 failed | 500 passed',
    stderr: '',
  })

describe('a killed check is not a failed check', () => {
  it('recognises the SIGTERM kill execSync uses for a timeout', () => {
    expect(isTimeoutKill(timeoutError())).toBe(true)
  })

  it('recognises an ETIMEDOUT rejection too', () => {
    // Node has reported the timeout both ways across versions; matching only
    // one of them is how this regresses quietly.
    expect(isTimeoutKill(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }))).toBe(true)
  })

  it('does NOT call an ordinary non-zero exit a timeout', () => {
    // The case that matters: real test failures must keep reading as failures.
    expect(isTimeoutKill(exitError(1))).toBe(false)
  })

  it('does not mistake a SIGINT for a timeout', () => {
    // Someone pressing Ctrl-C is not the gate running out of budget.
    expect(
      isTimeoutKill(Object.assign(new Error('interrupted'), { killed: false, signal: 'SIGINT' })),
    ).toBe(false)
  })

  it('says TIMED OUT, and names the budget it exceeded', () => {
    const outcome = describeCheckOutcome('Unit Tests (Vitest)', timeoutError(), 900_000)

    expect(outcome.timedOut).toBe(true)
    expect(outcome.label).toMatch(/timed out/i)
    // The number is the point: "it needs more than this" is the actionable part.
    expect(outcome.label).toContain('900')
  })

  it('explains in the report that nothing necessarily failed', () => {
    const outcome = describeCheckOutcome('Unit Tests (Vitest)', timeoutError(), 900_000)

    // Whoever reads the auto-filed task must not go hunting for a broken test
    // that does not exist.
    expect(outcome.summary).toMatch(/did not finish|was killed|no test failure/i)
  })

  it('leaves a genuine failure described as a failure', () => {
    const outcome = describeCheckOutcome('Unit Tests (Vitest)', exitError(1), 900_000)

    expect(outcome.timedOut).toBe(false)
    expect(outcome.label).toMatch(/failed/i)
    expect(outcome.label).not.toMatch(/timed out/i)
  })
})

describe('check budgets are big enough to be passable', () => {
  const checks = getChecks()

  it('gives every check an explicit timeout', () => {
    for (const check of checks) {
      expect(check.timeoutMs, `${check.name} has no timeout`).toBeTypeOf('number')
      expect(check.timeoutMs, `${check.name} timeout must be positive`).toBeGreaterThan(0)
    }
  })

  it('gives the unit suite room for its ACTUAL runtime, not an aspirational one', () => {
    // Measured at ~870s on a developer machine while filing this. A budget set
    // to the runtime is a budget that fails on a slower day, so it needs real
    // headroom — that is the whole reason 300s was a bug.
    const vitest = checks.find(check => check.name.includes('Vitest'))
    expect(vitest).toBeDefined()
    expect(vitest!.timeoutMs).toBeGreaterThanOrEqual(1_800_000)
  })

  it('gives the build more than the old 300s, which it was also close to', () => {
    // The build came in at 267.5s on one run — under the old limit by 32
    // seconds, which is not a margin, it is a coin toss.
    const build = checks.find(check => check.name === 'Build')
    expect(build).toBeDefined()
    expect(build!.timeoutMs).toBeGreaterThanOrEqual(900_000)
  })

  it('keeps the fast checks on a short leash so a hang is still caught', () => {
    // Raising every budget to half an hour would trade one bad failure mode
    // for another: a wedged lint would hold the gate for thirty minutes.
    const fast = checks.filter(check =>
      ['TypeScript', 'ESLint', 'Model Sync', 'Environment Registry'].includes(check.name),
    )
    expect(fast.length).toBeGreaterThan(0)
    for (const check of fast) {
      expect(check.timeoutMs, `${check.name} should stay quick`).toBeLessThanOrEqual(
        DEFAULT_CHECK_TIMEOUT_MS,
      )
    }
  })
})
