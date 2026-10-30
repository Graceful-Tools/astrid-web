/**
 * AWTD-1404 — a predeploy report that cannot be traced.
 *
 * On 2026-10-28 a report arrived in which eleven checks had each "failed" in
 * 0.0s, and every Output block read only `Command failed: npm run <check>`. The
 * shell had exited non-zero, or been killed, before printing a byte, and the
 * report kept none of what would have said which: no exit status, no signal.
 * It did not say which machine, checkout or commit had run it either, so the
 * search for its source ran out of leads.
 *
 * A failure with no output is still a failure with a cause. These pin the two
 * things a reader needs to find it: how the process ended, and where it ran.
 */

import { describe, it, expect } from 'vitest'
import { describeSilentFailure, reportProvenance } from '@/scripts/predeploy-self-healing'

describe('a check that fails without printing anything (AWTD-1404)', () => {
  it('names the exit status when the command exited on its own', () => {
    const out = describeSilentFailure('npm run typecheck', { status: 1, signal: null })
    expect(out).toContain('npm run typecheck')
    expect(out).toContain('printed nothing')
    expect(out).toContain('status 1')
  })

  it('names the signal when something killed the command', () => {
    const out = describeSilentFailure('npm run test:run', { status: null, signal: 'SIGKILL' })
    expect(out).toContain('SIGKILL')
    expect(out).not.toContain('status null')
  })

  it('still says something when neither is known', () => {
    expect(describeSilentFailure('npm run build:next', {})).toContain('printed nothing')
  })
})

describe('the report says where it ran (AWTD-1404)', () => {
  it('names the host, the checkout and the commit', () => {
    const line = reportProvenance({ host: 'Mac', cwd: '/Users/x/astrid-web', commit: 'ca87b2e8' })
    expect(line).toContain('Mac')
    expect(line).toContain('/Users/x/astrid-web')
    expect(line).toContain('ca87b2e8')
  })

  it('says the commit is unknown rather than leaving it blank', () => {
    expect(reportProvenance({ host: 'Mac', cwd: '/w', commit: null })).toContain('unknown')
  })
})
