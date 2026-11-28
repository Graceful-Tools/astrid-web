import { describe, expect, it } from 'vitest'
import { ciLogsEnv, failedLogArgs, parseCiLogsArgs, prBranchArgs, runListArgs, tailLines } from '../../scripts/lib/ci-logs'
import { renewalUrgency, usageLimitReset } from '../../scripts/lib/harness-start'
import { hasNeedsMacMarker, needsMac, needsMacFirst, isNeedsMacCandidate } from '../../scripts/lib/claim-next'
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

  it('reads with the agent token itself and refuses to run without it (ADEV-340)', () => {
    expect(ciLogsEnv({ GH_TOKEN: 'agent' }).GH_TOKEN).toBe('agent')
    expect(ciLogsEnv({ GH_TOKEN: 'agent' }).GH_PROMPT_DISABLED).toBe('1')
    expect(() => ciLogsEnv({})).toThrow(/GH_TOKEN/)
  })

  it('reads another app repo with --repo (ADEV-340)', () => {
    expect(parseCiLogsArgs(['--pr', '7', '--repo', 'Graceful-Tools/astrid-core']).repo).toBe('Graceful-Tools/astrid-core')
    expect(parseCiLogsArgs(['--pr', '7']).repo).toBeUndefined()
    expect(() => parseCiLogsArgs(['--pr', '7', '--repo', 'astrid-core'])).toThrow(/--repo/)
    expect(() => parseCiLogsArgs(['--pr', '7', '--repo', '--run'])).toThrow(/--repo/)
    const repo = 'Graceful-Tools/astrid-core'
    for (const args of [runListArgs('b', repo), prBranchArgs('1', repo), failedLogArgs('2', repo)]) {
      expect(args.slice(-2)).toEqual(['--repo', repo])
    }
    expect(runListArgs('b')).not.toContain('--repo')
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

  it('ADEV-363: a NEEDS-MAC comment keeps cloud runs off a task and puts it first locally', async () => {
    const marked = [{ content: 'NEEDS-MAC: needs the iOS emulator' }]
    expect(hasNeedsMacMarker(marked)).toBe(true)
    expect(hasNeedsMacMarker([{ content: 'a NEEDS-MAC: mention mid-text' }])).toBe(false)
    const comments = async (t: { id: string }) => (t.id === 'b' ? marked : [])
    expect(await needsMac({ id: 'b', title: 'x' }, comments)).toBe(true)
    expect(await needsMac({ id: 'a', title: 'x' }, comments)).toBe(false)
    expect(await needsMac({ id: 'a', title: 'x' }, async () => { throw new Error('down') })).toBe(false)
    const ordered = await needsMacFirst([{ id: 'a' }, { id: 'b' }, { id: 'c' }], comments)
    expect(ordered.map(t => t.id)).toEqual(['b', 'a', 'c'])
  })

  it('picks the open PR at the recorded sha over an older closed one listed first', () => {
    const closed = { state: 'CLOSED', baseRefName: 'main', headRefOid: 'b'.repeat(40) }
    const open = { state: 'OPEN', baseRefName: 'main', headRefOid: SHA }
    expect(pickHandoffPr([closed, open], SHA)).toBe(open)
    expect(pickHandoffPr([closed], SHA)).toBe(closed)
    expect(pickHandoffPr([], SHA)).toBeUndefined()
  })
})
