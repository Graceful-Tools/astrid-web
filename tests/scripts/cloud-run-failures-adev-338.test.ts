import { describe, expect, it } from 'vitest'
import { ciLogsEnv, failedLogArgs, parseCiLogsArgs, prBranchArgs, runListArgs, tailLines } from '../../scripts/lib/ci-logs'
import { renewalUrgency, usageLimitReset } from '../../scripts/lib/harness-start'
import { isNeedsMacCandidate } from '../../scripts/lib/claim-next'
import { pickHandoffPr } from '../../scripts/lib/cloud-handoff'

const SHA = 'a'.repeat(40)

describe('ADEV-338: ci:logs', () => {
  it('takes exactly one target', () => {
    expect(parseCiLogsArgs(['--pr', '12'])).toEqual({ target: { kind: 'pr', number: '12' }, tail: 200 })
    expect(parseCiLogsArgs(['--run', '99', '--tail', '50']).tail).toBe(50)
    expect(() => parseCiLogsArgs([])).toThrow()
    expect(() => parseCiLogsArgs(['--pr', '1', '--run', '2'])).toThrow()
    expect(() => parseCiLogsArgs(['--run', 'abc'])).toThrow()
    expect(() => parseCiLogsArgs(['--branch', '--delete'])).toThrow()
  })

  it('only builds read commands', () => {
    const verbs = [runListArgs('b'), prBranchArgs('1'), failedLogArgs('2')].map(args => `${args[0]} ${args[1]}`)
    expect(verbs).toEqual(['run list', 'pr view', 'run view'])
  })

  it('swaps in the job token and refuses to run without it', () => {
    expect(ciLogsEnv({ CI_LOGS_GH_TOKEN: 't', GH_TOKEN: 'agent' }).GH_TOKEN).toBe('t')
    expect(() => ciLogsEnv({ GH_TOKEN: 'agent' })).toThrow(/CI_LOGS_GH_TOKEN/)
  })

  it('keeps the end of a long log', () => {
    const log = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n')
    expect(tailLines(log, 3)).toBe('… 7 earlier lines omitted (raise --tail to see more)\nline 7\nline 8\nline 9')
    expect(tailLines('short\n', 3)).toBe('short')
  })
})

describe('ADEV-338: handing work off', () => {
  it('treats a usage limit as no token failure', () => {
    expect(usageLimitReset('You’ve hit your weekly limit · resets Nov 20')).toBe('Nov 20')
    expect(usageLimitReset('hit your limit')).toBe('unknown')
    expect(usageLimitReset('Failed to authenticate: OAuth token revoked')).toBeNull()
  })

  it('files the renewal task due now with a reminder', () => {
    const now = new Date('2026-11-27T12:00:00Z')
    expect(renewalUrgency(now)).toEqual({
      priority: 3,
      dueDateTime: '2026-11-27T12:00:00.000Z',
      reminderTime: '2026-11-27T12:00:00.000Z',
      reminderType: 'both',
    })
  })

  it('skips a [mac] task on the cloud', () => {
    expect(isNeedsMacCandidate({ id: '1', title: '[mac] Sign the build' })).toBe(true)
    expect(isNeedsMacCandidate({ id: '1', title: ' [Needs-Mac] x' })).toBe(true)
    expect(isNeedsMacCandidate({ id: '1', title: 'Fix the macOS layout [mac]' })).toBe(false)
    expect(isNeedsMacCandidate({ id: '1', title: null })).toBe(false)
  })

  it('picks the open PR at the recorded sha over an older closed one listed first', () => {
    const closed = { state: 'CLOSED', baseRefName: 'main', headRefOid: 'b'.repeat(40) }
    const open = { state: 'OPEN', baseRefName: 'main', headRefOid: SHA }
    expect(pickHandoffPr([closed, open], SHA)).toBe(open)
    expect(pickHandoffPr([closed], SHA)).toBe(closed)
    expect(pickHandoffPr([], SHA)).toBeUndefined()
  })
})
