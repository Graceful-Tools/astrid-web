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
const findMany = vi.hoisted(() => vi.fn())
const taskUpdate = vi.hoisted(() => vi.fn())
const linkUpdate = vi.hoisted(() => vi.fn())
const taskCreate = vi.hoisted(() => vi.fn())
const linkCreate = vi.hoisted(() => vi.fn())
const transaction = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    externalTaskLink: { findFirst, findMany, update: linkUpdate, create: linkCreate },
    task: { update: taskUpdate },
    $transaction: transaction,
  },
}))

import { applyPulledIssues } from '@/lib/sync/github/apply-issues'
import type { PulledIssue } from '@/lib/sync/github/pull-issues'

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
  notes: 'details',
  completed: false,
  completedAt: null,
  closedReason: null,
  remoteUpdatedAt: '2026-08-15T10:00:00Z',
  metadata: {
    number: '1',
    parent: '',
    assigneeUserId: '',
    commentCount: '0',
    labels: '',
    assignees: '',
    state_reason: '',
  },
  ...over,
}) as never

/**
 * A row as the BATCH lookup returns it. `remoteId` is what keys the map, so a
 * fixture without it silently looks like "no existing link" and the test would
 * assert a create while claiming to assert an update.
 */
const existingLink = (over: Record<string, unknown> = {}) => ({
  id: 'etl-1',
  astridTaskId: 'task-1',
  remoteId: 'owner/repo#1',
  remoteUpdatedAt: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  findFirst.mockResolvedValue(null)
  findMany.mockResolvedValue([])
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
    findMany.mockResolvedValue([existingLink({ remoteUpdatedAt: new Date('2026-08-15T09:00:00Z') })])

    const result = await applyPulledIssues({ link: LINK, items: [issue()] })

    expect(result).toMatchObject({ updated: 1, created: 0 })
    expect(taskCreate).not.toHaveBeenCalled()
  })

  it('SKIPS a re-delivered issue instead of clobbering local edits', async () => {
    // Same timestamp we already recorded — the steady-state boundary case.
    findMany.mockResolvedValue([existingLink({ remoteUpdatedAt: new Date('2026-08-15T10:00:00Z') })])

    const result = await applyPulledIssues({ link: LINK, items: [issue()] })

    expect(result).toMatchObject({ skipped: 1, updated: 0 })
    expect(taskUpdate).not.toHaveBeenCalled()
  })

  it('applies nothing for an export-only link', async () => {
    // EXPORT is the real push-only value. An earlier draft of both the guard
    // AND this test used an invented 'PUSH_ONLY', so the test passed while the
    // guard was dead code — the enum is EXPORT | IMPORT | BIDIRECTIONAL.
    const result = await applyPulledIssues({
      link: { ...LINK, direction: 'EXPORT' },
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

  it('reads the field names the pull actually emits', async () => {
    // Regression guard for a bug caught in review: this module originally
    // declared its own PulledIssue with `body`/`updatedAt`, but the pull emits
    // `notes`/`remoteUpdatedAt`. Nothing failed to compile — the optional
    // fields were simply always undefined, so descriptions never synced and
    // isStale never fired, meaning every run reapplied every issue. The type
    // now comes FROM the pull, and this asserts the values reach Prisma.
    const item: PulledIssue = issue({ notes: 'the real body' })
    findMany.mockResolvedValue([existingLink({ remoteUpdatedAt: new Date('2026-08-15T09:00:00Z') })])

    await applyPulledIssues({ link: LINK, items: [item] })

    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ description: 'the real body' }) }),
    )
  })

  it('PROPAGATES a non-unique failure so the caller does not commit the cursor', async () => {
    // The data-loss path: if this were swallowed as a skip, apply would return
    // cleanly, the caller would advance the `since` watermark, and this issue
    // would never be offered again.
    transaction.mockRejectedValue(Object.assign(new Error('db is down'), { code: 'P1001' }))

    await expect(applyPulledIssues({ link: LINK, items: [issue()] })).rejects.toThrow('db is down')
  })

  it('applies an issue with no recorded remote timestamp rather than skipping it', async () => {
    findMany.mockResolvedValue([existingLink({ remoteUpdatedAt: null })])

    const result = await applyPulledIssues({ link: LINK, items: [issue()] })

    expect(result).toMatchObject({ updated: 1 })
  })
})

/**
 * Task f9ba26b3 — the N+1.
 *
 * Applying a batch used to cost one `findFirst` per item before it did any
 * work: 300 changed issues meant 300 sequential existence probes inside one
 * link's turn of a 60-second pass, on top of the writes. The lookup is now one
 * query for the whole batch, which is exact rather than approximate because
 * `@@unique([provider, remoteId, userId])` guarantees at most one row per key.
 */
describe('applyPulledIssues batches its lookups (task f9ba26b3)', () => {
  const batch = [
    issue({ remoteId: 'owner/repo#1' }),
    issue({ remoteId: 'owner/repo#2' }),
    issue({ remoteId: 'owner/repo#3' }),
  ]

  it('looks the whole batch up in ONE query, not one per item', async () => {
    await applyPulledIssues({ link: LINK, items: batch })

    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findFirst).not.toHaveBeenCalled()
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: 'GITHUB_ISSUES',
          userId: 'user-1',
          remoteId: { in: ['owner/repo#1', 'owner/repo#2', 'owner/repo#3'] },
        }),
      }),
    )
  })

  it('asks only for the ids it is actually applying', async () => {
    // A malformed item has no remoteId to look up; sending `undefined` into an
    // `in` list is how a bounded query turns into an unbounded one.
    await applyPulledIssues({
      link: LINK,
      items: [issue({ remoteId: 'owner/repo#1' }), issue({ remoteId: '' }), issue({ title: '' })],
    })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ remoteId: { in: ['owner/repo#1'] } }),
      }),
    )
  })

  it('does not query at all when there is nothing applicable', async () => {
    await applyPulledIssues({ link: LINK, items: [issue({ title: '' })] })

    expect(findMany).not.toHaveBeenCalled()
  })

  it('does not re-import an issue it created earlier in the SAME batch', async () => {
    // The hazard the prefetched map introduces: the snapshot is taken before
    // the loop runs, so a repeated remoteId would miss the map twice and be
    // imported twice — a duplicate that the per-item findFirst could not
    // produce. The map has to learn about what the loop creates.
    const result = await applyPulledIssues({
      link: LINK,
      items: [issue({ remoteId: 'owner/repo#9' }), issue({ remoteId: 'owner/repo#9' })],
    })

    expect(taskCreate).toHaveBeenCalledTimes(1)
    expect(result.created).toBe(1)
  })

  it('still PROPAGATES a failure when other items in the batch succeed', async () => {
    // Concurrency must not turn a hard failure into a clean return: the caller
    // commits the `since` watermark on a clean return, so a swallowed error
    // here is the silent permanent loss this module exists to prevent.
    findMany.mockResolvedValue([])
    transaction
      .mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ task: { create: taskCreate }, externalTaskLink: { create: linkCreate } }),
      )
      .mockRejectedValueOnce(Object.assign(new Error('db is down'), { code: 'P1001' }))
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ task: { create: taskCreate }, externalTaskLink: { create: linkCreate } }),
      )

    await expect(applyPulledIssues({ link: LINK, items: batch })).rejects.toThrow('db is down')
  })
})
