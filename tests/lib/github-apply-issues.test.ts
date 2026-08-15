/**
 * Task d8de37c1 — applying pulled GitHub issues to tasks.
 *
 * The cases here are the ones that decide whether a sync driver is usable at
 * all. Two matter most:
 *
 *   RE-DELIVERY. The cursor is a `since` watermark on updated_at, and GitHub
 *   returns items updated AT the boundary — so a steady state re-delivers the
 *   same last issue every run. Without the staleness check, every cron tick
 *   would rewrite that task and clobber whatever a user changed in between.
 *
 *   DUPLICATE IMPORT. A task created without its ExternalTaskLink is
 *   indistinguishable from a new issue next run, so it gets imported again, and
 *   again. Writing both in one transaction is what stops that.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const findFirst = vi.hoisted(() => vi.fn())
const taskUpdate = vi.hoisted(() => vi.fn())
const linkUpdate = vi.hoisted(() => vi.fn())
const taskCreate = vi.hoisted(() => vi.fn())
const linkCreate = vi.hoisted(() => vi.fn())
const transaction = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    externalTaskLink: { findFirst, update: linkUpdate, create: linkCreate },
    task: { update: taskUpdate },
    $transaction: transaction,
  },
}))

import { applyPulledIssues } from '@/lib/sync/github/apply-issues'

const LINK = {
  id: 'link-1',
  userId: 'user-1',
  integrationId: 'int-1',
  astridListId: 'list-1',
  remoteContainerId: 'owner/repo',
  direction: 'BIDIRECTIONAL',
}

const issue = (over: Record<string, unknown> = {}) => ({
  remoteId: 'owner/repo#1',
  title: 'Fix the thing',
  body: 'details',
  completed: false,
  updatedAt: '2026-08-15T10:00:00Z',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  findFirst.mockResolvedValue(null)
  taskCreate.mockResolvedValue({ id: 'task-new' })
  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ task: { create: taskCreate }, externalTaskLink: { create: linkCreate } }),
  )
})

describe('applyPulledIssues (task d8de37c1)', () => {
  it('creates a task and its link together for a new issue', async () => {
    const result = await applyPulledIssues({ link: LINK, items: [issue()] })

    expect(result).toMatchObject({ created: 1, updated: 0 })
    expect(taskCreate).toHaveBeenCalled()
    // Both in ONE transaction: a task without its link is re-imported next run.
    expect(linkCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ remoteId: 'owner/repo#1', astridTaskId: 'task-new' }),
      }),
    )
    expect(transaction).toHaveBeenCalled()
  })

  it('updates an existing task when the issue is genuinely newer', async () => {
    findFirst.mockResolvedValue({
      id: 'etl-1',
      astridTaskId: 'task-1',
      remoteUpdatedAt: new Date('2026-08-15T09:00:00Z'),
    })

    const result = await applyPulledIssues({ link: LINK, items: [issue()] })

    expect(result).toMatchObject({ updated: 1, created: 0 })
    expect(taskCreate).not.toHaveBeenCalled()
  })

  it('SKIPS a re-delivered issue instead of clobbering local edits', async () => {
    // Same timestamp we already recorded — the steady-state boundary case.
    findFirst.mockResolvedValue({
      id: 'etl-1',
      astridTaskId: 'task-1',
      remoteUpdatedAt: new Date('2026-08-15T10:00:00Z'),
    })

    const result = await applyPulledIssues({ link: LINK, items: [issue()] })

    expect(result).toMatchObject({ skipped: 1, updated: 0 })
    expect(taskUpdate).not.toHaveBeenCalled()
  })

  it('applies nothing for a push-only link', async () => {
    const result = await applyPulledIssues({
      link: { ...LINK, direction: 'PUSH_ONLY' },
      items: [issue(), issue({ remoteId: 'owner/repo#2' })],
    })

    expect(result).toMatchObject({ created: 0, updated: 0, skipped: 2 })
    expect(transaction).not.toHaveBeenCalled()
  })

  it('skips malformed items rather than writing a titleless task', async () => {
    const result = await applyPulledIssues({
      link: LINK,
      items: [issue({ title: '' }), issue({ remoteId: '' })],
    })

    expect(result.skipped).toBe(2)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('treats a concurrent create as a skip, not a failure', async () => {
    // Two runs overlapping is the desired end state either way; the unique
    // index on (provider, remoteId, userId) is what makes this safe.
    transaction.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))

    const result = await applyPulledIssues({ link: LINK, items: [issue()] })

    expect(result).toMatchObject({ created: 0, skipped: 1 })
  })

  it('PROPAGATES a non-unique failure so the caller does not commit the cursor', async () => {
    // The data-loss path: if this were swallowed as a skip, apply would return
    // cleanly, the caller would advance the `since` watermark, and this issue
    // would never be offered again.
    transaction.mockRejectedValue(Object.assign(new Error('db is down'), { code: 'P1001' }))

    await expect(applyPulledIssues({ link: LINK, items: [issue()] })).rejects.toThrow('db is down')
  })

  it('applies an issue with no recorded remote timestamp rather than skipping it', async () => {
    findFirst.mockResolvedValue({ id: 'etl-1', astridTaskId: 'task-1', remoteUpdatedAt: null })

    const result = await applyPulledIssues({ link: LINK, items: [issue()] })

    expect(result).toMatchObject({ updated: 1 })
  })
})
