/**
 * ADEV-310: a task whose work already has an open PR is not claimed again.
 *
 * A claim lease that lapsed mid-work put the task back in Ready while its PR was open, and
 * the next cloud worker built it a second time (#1015/#1016, #1018/#1020). claim-next now
 * passes over a Ready task whose identifier stands alone in an open PR's head branch, logs
 * the skip and takes the next task, unless the task was sent back to be resumed from that
 * branch (a ship-workflow rework or a stale-Doing release). Every lookup fails open.
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { EXPIRED_LEASE_MARKER, expiredLeaseComment } from '@/lib/agent-task-claim'
import { RELEASE_MARKER, REWORK_MARKER } from '@/scripts/lib/doing-release'
import {
  claimNextReady,
  isCoreCandidate,
  openPrBranchFor,
  openPrBranches,
  sentBackToResume,
  skipTasksWithOpenPr,
  type ClaimCandidate,
} from '@/scripts/lib/claim-next'

const task = (identifier: string, title = `Task ${identifier}`): ClaimCandidate => ({ id: `id-${identifier}`, identifier, title })

describe('openPrBranchFor (ADEV-310)', () => {
  const branches = ['agent/claude-code/ADEV-310-heartbeat-claim-fields', 'agent/codex/awtd-1567-sync', 'feature/other']

  it('finds the open PR branch that names the task', () => {
    expect(openPrBranchFor(task('ADEV-310'), branches)).toBe('agent/claude-code/ADEV-310-heartbeat-claim-fields')
  })
  it('matches the identifier case-insensitively', () => {
    expect(openPrBranchFor(task('AWTD-1567'), branches)).toBe('agent/codex/awtd-1567-sync')
  })
  it('does not match a prefix of a longer number, or a longer key', () => {
    expect(openPrBranchFor(task('ADEV-31'), branches)).toBeUndefined()
    expect(openPrBranchFor(task('DEV-310'), branches)).toBeUndefined()
  })
  it('a task without an identifier never matches', () => {
    expect(openPrBranchFor({ id: 'x', identifier: null }, branches)).toBeUndefined()
  })
})

describe('openPrBranches fails open (ADEV-310)', () => {
  it('returns [] and logs when the lookup throws', () => {
    const log = vi.fn()
    expect(openPrBranches(() => { throw new Error('gh: not authenticated') }, log)).toEqual([])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('OPEN_PR_LOOKUP_FAILED'))
  })
  it('drops empty lines', () => {
    expect(openPrBranches(() => ['a', '', 'b'])).toEqual(['a', 'b'])
  })
})

describe('claimNextReady with the open-PR skip (ADEV-310)', () => {
  it('skips a task that has an open PR, logs it, and claims the next', async () => {
    const lines: string[] = []
    const log = (line: string) => lines.push(line)
    const claim = vi.fn(async () => 'claimed' as const)
    const result = await claimNextReady({
      initial: [task('ADEV-310'), task('ADEV-311')],
      refresh: async () => [],
      skip: skipTasksWithOpenPr({ openBranches: ['agent/claude-code/ADEV-310-fix'], comments: async () => [], log }),
      claim,
      log,
    })
    expect(result.claimed?.identifier).toBe('ADEV-311')
    expect(result.skipped).toEqual(['id-ADEV-310'])
    expect(claim).toHaveBeenCalledTimes(1)
    expect(lines.some(line => line.startsWith('SKIP_OPEN_PR ADEV-310') && line.includes('agent/claude-code/ADEV-310-fix'))).toBe(true)
  })

  it('a failed lookup blocks nothing', async () => {
    const branches = openPrBranches(() => { throw new Error('network') })
    const result = await claimNextReady({
      initial: [task('ADEV-310')],
      refresh: async () => [],
      skip: skipTasksWithOpenPr({ openBranches: branches, comments: async () => [], log: () => {} }),
      claim: async () => 'claimed',
    })
    expect(result.claimed?.identifier).toBe('ADEV-310')
  })

  it('still applies the other skip (core tasks)', async () => {
    const skip = skipTasksWithOpenPr({ openBranches: [], comments: async () => [], log: () => {}, otherwise: isCoreCandidate })
    expect(await skip(task('ADEV-1', '[core] something'))).toBe(true)
    expect(await skip(task('ADEV-2', 'web thing'))).toBe(false)
  })

  it('claims a task the ship workflow sent back for rework, and logs why', async () => {
    const lines: string[] = []
    const skip = skipTasksWithOpenPr({
      openBranches: ['agent/claude-code/ADEV-310-fix'],
      comments: async () => [{ content: `${REWORK_MARKER}: PR #9 cannot land. The finished work is on \`agent/claude-code/ADEV-310-fix\``, createdAt: '2026-11-26T08:00:00Z' }],
      log: line => lines.push(line),
    })
    expect(await skip(task('ADEV-310'))).toBe(false)
    expect(lines[0]).toMatch(/^OPEN_PR_RESUME ADEV-310/)
  })

  it('a failed comment read claims the task (fail-open)', async () => {
    const skip = skipTasksWithOpenPr({
      openBranches: ['agent/claude-code/ADEV-310-fix'],
      comments: async () => { throw new Error('HTTP 500') },
      log: () => {},
    })
    expect(await skip(task('ADEV-310'))).toBe(false)
  })

  it('claim-next-fixall-task.ts wires the guard in', () => {
    const src = readFileSync('scripts/claim-next-fixall-task.ts', 'utf8')
    expect(src).toContain('skip: skipTasksWithOpenPr({')
    expect(src).toContain('comments: task => client.getComments(task.id)')
    expect(src).toMatch(/openPrBranches\(\(\) => \{/)
  })
})

describe('sentBackToResume (ADEV-310)', () => {
  const branch = 'agent/claude-code/ADEV-310-fix'
  const rework = { content: `${REWORK_MARKER}: PR #9 cannot land. Work is on \`${branch}\``, createdAt: '2026-11-26T08:00:00Z' }
  const release = { content: `${RELEASE_MARKER}. Its work so far is on \`${branch}\``, createdAt: '2026-11-26T08:00:00Z' }
  const lapsed = (createdAt: string) => ({ content: expiredLeaseComment(null, new Date(createdAt)), createdAt })

  it('the expired-lease comment starts with the marker it reads', () => {
    expect(expiredLeaseComment(null, new Date('2026-11-26T08:00:00Z')).startsWith(EXPIRED_LEASE_MARKER)).toBe(true)
  })
  it('a rework or a release naming the branch means resume', () => {
    expect(sentBackToResume([rework], branch)).toBe(true)
    expect(sentBackToResume([release], branch)).toBe(true)
  })
  it('a lapsed lease alone, or one newer than the send-back, means a duplicate', () => {
    expect(sentBackToResume([lapsed('2026-11-26T08:30:00Z')], branch)).toBe(false)
    expect(sentBackToResume([rework, lapsed('2026-11-26T08:30:00Z')], branch)).toBe(false)
  })
  it('a send-back newer than the lapsed lease means resume', () => {
    expect(sentBackToResume([lapsed('2026-11-26T07:30:00Z'), rework], branch)).toBe(true)
  })
  it('a send-back naming a different branch does not count', () => {
    expect(sentBackToResume([rework], 'agent/codex/ADEV-310-other')).toBe(false)
  })
  it('no comments: the open PR stands', () => {
    expect(sentBackToResume([], branch)).toBe(false)
  })
})
