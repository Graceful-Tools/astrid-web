/**
 * The scheduled Waiting settle job and its backfill (Jon, 2026-11-12): services/waiting-settle-job.ts.
 *
 * Dry-run writes nothing; apply writes through applySettlement; a condition-less Waiting task is
 * the backfill's while native enforcement is lenient (so a native drag is not bounced in a loop);
 * the report names tasks only on the reader's own boards.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rows = vi.hoisted(() => ({ tasks: [] as any[] }))
const applySettlement = vi.hoisted(() => vi.fn(async () => true))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findMany: vi.fn(async ({ cursor, where }: any) => {
        // The reader-owned lookup: ids on boards the reader (jon) owns, by list or by project.
        if (where?.id?.in) {
          return rows.tasks
            .filter(t => where.id.in.includes(t.id) && t.lists.some((l: any) => l.ownerId === 'jon' || l.project?.ownerId === 'jon'))
            .map(t => ({ id: t.id }))
        }
        return cursor ? [] : rows.tasks
      }),
    },
  },
}))
vi.mock('@/services/task-dependency.service', () => ({ applySettlement }))

const NOW = new Date('2026-11-12T12:00:00.000Z')
const PAST = new Date('2026-11-10T00:00:00.000Z')
const FUTURE = new Date('2026-11-20T00:00:00.000Z')

function task(id: string, over: Record<string, unknown> = {}) {
  return {
    id, title: `title ${id}`, identifier: `AWTD-${id}`, statusRole: 'waiting', dueDateTime: null, isAllDay: false,
    assigneeId: null, completed: false, blockedBy: [], lists: [{ ownerId: 'someone-else', project: null }], ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  rows.tasks = [
    task('wake', { dueDateTime: PAST }),
    task('park', { statusRole: 'ready', dueDateTime: FUTURE, assigneeId: 'agent', lists: [{ ownerId: 'jon', project: null }] }),
    task('legacy', { assigneeId: 'jon' }),
    task('assigned', { dueDateTime: FUTURE, assigneeId: 'agent', lists: [{ ownerId: 'x', project: { ownerId: 'jon' } }] }),
    task('held', { blockedBy: [{ blockingTaskId: 'b', blockingTask: { completed: false } }] }),
  ]
})

describe('planTask', () => {
  it('splits settle and backfill as the rules say', async () => {
    const { planTask } = await import('@/services/waiting-settle-job')
    const plan = (id: string, enforcement: 'lenient' | 'enforce' = 'lenient') => planTask(rows.tasks.find(t => t.id === id), NOW, enforcement)
    expect(plan('wake')).toEqual({ settle: { settlement: { action: 'wakeToReady', statusRole: 'ready', assignee: 'keep' }, heldForBackfill: false } })
    expect(plan('park').settle?.settlement).toEqual({ action: 'parkInWaiting', statusRole: 'waiting', assignee: 'clear' })
    expect(plan('legacy')).toMatchObject({ backfill: 'toInbox', settle: { heldForBackfill: true } })
    expect(plan('legacy', 'enforce')).toMatchObject({ backfill: 'toInbox', settle: { heldForBackfill: false } })
    expect(plan('assigned')).toEqual({ backfill: 'unassign' })
    expect(plan('held')).toEqual({})
  })
})

describe('runWaitingSettleJob', () => {
  it('dry-run writes nothing and reports counts, naming only the reader\'s boards', async () => {
    const { runWaitingSettleJob } = await import('@/services/waiting-settle-job')
    const report = await runWaitingSettleJob({ now: NOW, settleMode: 'dry-run', backfillMode: 'dry-run', nativeEnforcement: 'lenient', readerId: 'jon' })
    expect(applySettlement).not.toHaveBeenCalled()
    expect(report.scanned).toBe(5)
    expect(report.settle.counts).toEqual({ wakeToReady: 1, parkInWaiting: 1 })
    expect(report.settle.heldForBackfill).toBe(1)
    expect(report.backfill.counts).toEqual({ unassign: 1, toInbox: 1 })
    expect(report.detail.map(move => move.identifier).sort()).toEqual(['AWTD-assigned', 'AWTD-park'])
    expect(JSON.stringify(report)).not.toContain('title wake')
  })

  it('defaults to dry-run from an unset env', async () => {
    const { runWaitingSettleJob } = await import('@/services/waiting-settle-job')
    const report = await runWaitingSettleJob({ now: NOW })
    expect(report.settleMode).toBe('dry-run')
    expect(report.backfillMode).toBe('dry-run')
    expect(applySettlement).not.toHaveBeenCalled()
  })

  it('apply writes each planned move; off skips the scan', async () => {
    const { runWaitingSettleJob } = await import('@/services/waiting-settle-job')
    const report = await runWaitingSettleJob({ now: NOW, settleMode: 'apply', backfillMode: 'apply', nativeEnforcement: 'lenient' })
    expect(report.settle.applied).toBe(2)
    expect(report.backfill.applied).toBe(2)
    expect(applySettlement).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'legacy', from: 'waiting', to: null, clearAssignee: false }))
    expect(applySettlement).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'assigned', to: 'waiting', clearAssignee: true }))
    expect(applySettlement).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'park', to: 'waiting', clearAssignee: true }))

    applySettlement.mockClear()
    const off = await runWaitingSettleJob({ now: NOW, settleMode: 'off', backfillMode: 'off' })
    expect(off.scanned).toBe(0)
    expect(applySettlement).not.toHaveBeenCalled()
  })

  it('a settle in apply mode does not bounce a lenient native Waiting task to Inbox', async () => {
    const { runWaitingSettleJob } = await import('@/services/waiting-settle-job')
    await runWaitingSettleJob({ now: NOW, settleMode: 'apply', backfillMode: 'off', nativeEnforcement: 'lenient' })
    expect(applySettlement).not.toHaveBeenCalledWith(expect.objectContaining({ taskId: 'legacy' }))
  })
})
