/**
 * AWTD-1655 — a predeploy run in which no check could even start.
 *
 * On 2026-11-14 JonsYoga filed a report naming all eighteen checks as failed.
 * Each had taken 0.0s, printed nothing, and exited 3221225794 — Windows'
 * 0xC0000142, STATUS_DLL_INIT_FAILED: the process was never started. Even
 * `git rev-parse` failed, so the report said "an unknown commit". Nothing in
 * the code was wrong; the machine could not launch a process. The report read
 * as eighteen broken checks, and the auto-fix retries ran twice more for
 * nothing.
 *
 * These pin the two things that would have made it read correctly: the status
 * decoded, and the whole run recognised as an environment failure.
 */

import { describe, it, expect } from 'vitest'
import {
  describeSilentFailure,
  isEnvironmentLaunchFailure,
} from '@/scripts/predeploy-self-healing'

const silent = (cmd: string, status = 3221225794) => ({
  output: describeSilentFailure(cmd, { status, signal: null }),
  duration: 20,
})

describe('a Windows launch status is decoded (AWTD-1655)', () => {
  it('names 0xC0000142 and says the process never started', () => {
    const out = describeSilentFailure('npm run typecheck', { status: 3221225794, signal: null })
    expect(out).toContain('3221225794')
    expect(out).toContain('0xC0000142')
    expect(out).toContain('STATUS_DLL_INIT_FAILED')
  })

  it('leaves an ordinary exit status alone', () => {
    const out = describeSilentFailure('npm run lint', { status: 1, signal: null })
    expect(out).toBe('`npm run lint` printed nothing and exited with status 1.')
  })
})

describe('a run where nothing could start is an environment failure (AWTD-1655)', () => {
  it('is recognised when every failed check died instantly and silently', () => {
    const failed = ['npm run typecheck', 'npm run lint', 'npm run test:run', 'npm run build:next'].map((c) =>
      silent(c),
    )
    expect(isEnvironmentLaunchFailure(failed)).toBe(true)
  })

  it('is not claimed when a check printed real output', () => {
    const failed = [
      silent('npm run typecheck'),
      silent('npm run lint'),
      { output: 'src/a.ts(1,1): error TS2322: nope', duration: 30 },
    ]
    expect(isEnvironmentLaunchFailure(failed)).toBe(false)
  })

  it('is not claimed when a silent check ran for a while', () => {
    const failed = [silent('npm run typecheck'), silent('npm run lint'), { ...silent('npm run test:run'), duration: 45_000 }]
    expect(isEnvironmentLaunchFailure(failed)).toBe(false)
  })

  it('is not claimed for one or two silent failures, which can be real', () => {
    expect(isEnvironmentLaunchFailure([silent('npm run lint', 1), silent('npm run typecheck', 2)])).toBe(false)
  })
})
