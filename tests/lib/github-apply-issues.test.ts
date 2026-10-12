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
 *   again. A stable clientRequestId per issue is what stops that: a retry
 *   gets the same task back and links it (AWTD-1123; it was a transaction).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const findFirst = vi.hoisted(() => vi.fn())
const findMany = vi.hoisted(() => vi.fn())
const taskUpdate = vi.hoisted(() => vi.fn())
const linkUpdate = vi.hoisted(() => vi.fn())
const taskCreate = vi.hoisted(() => vi.fn())
const linkCreate = vi.hoisted(() => vi.fn())
const transaction = vi.hoisted(() => vi.fn())
const updateTaskWithSideEffects = vi.hoisted(() => vi.fn())
const createTaskWithSideEffects = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    externalTaskLink: { findFirst, findMany, update: linkUpdate, create: linkCreate },
    task: { update: taskUpdate },
    $transaction: transaction,
  },
}))

// Updates (AWTD-1093) and creates (AWTD-1123) go through the one task write path.
vi.mock('@/services/task.service', () => ({ updateTaskWithSideEffects, createTaskWithSideEffects }))

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
  // The linked task as it stands, so apply can tell a real change from a
  // re-delivery of the same content.
  task: { title: 'Old title', description: 'details', completed: false, closedReason: null },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  findFirst.mockResolvedValue(null)
  findMany.mockResolvedValue([])
  taskCreate.mockResolvedValue({ id: 'task-new' })
  createTaskWithSideEffects.mockResolvedValue({ ok: true, task: { id: 'task-new' }, idempotent: false })
  linkCreate.mockResolvedValue({ id: 'etl-new' })
  updateTaskWithSideEffects.mockResolvedValue({ ok: true, task: { id: 'task-1' }, rolledForward: false })
  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ task: { create: taskCreate }, externalTaskLink: { create: linkCreate } }),
  )
})

describe('applyPulledIssues (task d8de37c1)', () => {
  it('creates a task and then its link for a new issue', async () => {
    const result = await applyPulledIssues({ link: LINK, items: [issue()] })

    expect(result).toMatchObject({ created: 1, updated: 0 })
    expect(createTaskWithSideEffects).toHaveBeenCalled()
    expect(linkCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ remoteId: 'owner/repo#1', astridTaskId: 'task-new' }),
      }),
    )
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
    expect(updateTaskWithSideEffects).not.toHaveBeenCalled()
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
    expect(createTaskWithSideEffects).not.toHaveBeenCalled()
  })

  it('skips malformed items rather than writing a titleless task', async () => {
    const result = await applyPulledIssues({
      link: LINK,
      items: [issue({ title: '' }), issue({ remoteId: '' })],
    })

    expect(result.skipped).toBe(2)
    expect(createTaskWithSideEffects).not.toHaveBeenCalled()
  })

  it('treats a concurrent create as a skip, not a failure', async () => {
    // Two runs overlapping is the desired end state either way; the unique
    // index on (provider, remoteId, userId) is what makes this safe. Both runs
    // got the SAME task from the create (one clientRequestId per issue), so the
    // losing link write leaves no orphan behind.
    linkCreate.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))

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

    expect(updateTaskWithSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({ intent: expect.objectContaining({ description: 'the real body' }) }),
    )
  })

  it('PROPAGATES a non-unique failure so the caller does not commit the cursor', async () => {
    // The data-loss path: if this were swallowed as a skip, apply would return
    // cleanly, the caller would advance the `since` watermark, and this issue
    // would never be offered again.
    linkCreate.mockRejectedValue(Object.assign(new Error('db is down'), { code: 'P1001' }))

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

    expect(createTaskWithSideEffects).toHaveBeenCalledTimes(1)
    expect(result.created).toBe(1)
  })

  it('still PROPAGATES a failure when other items in the batch succeed', async () => {
    // Concurrency must not turn a hard failure into a clean return: the caller
    // commits the `since` watermark on a clean return, so a swallowed error
    // here is the silent permanent loss this module exists to prevent.
    findMany.mockResolvedValue([])
    linkCreate
      .mockResolvedValueOnce({ id: 'etl-a' })
      .mockRejectedValueOnce(Object.assign(new Error('db is down'), { code: 'P1001' }))
      .mockResolvedValue({ id: 'etl-c' })

    await expect(applyPulledIssues({ link: LINK, items: batch })).rejects.toThrow('db is down')
  })
})

/**
 * AWTD-1093 — a closed issue completes its task through the service.
 *
 * The raw `task.update({ completed })` stamped no completedSource, left the
 * board lane set on a done task, never promoted the tasks it was blocking and
 * broadcast nothing. And because it wrote even when nothing had changed, every
 * re-applied issue bumped updatedAt — which push then read as a local edit.
 */
describe('applyPulledIssues writes through the task service (AWTD-1093)', () => {
  const newer = { remoteUpdatedAt: new Date('2026-08-15T09:00:00Z') }

  it('completes a task whose issue was closed, as the link owner, with completedSource github', async () => {
    findMany.mockResolvedValue([existingLink({ ...newer, task: { title: 'Fix the thing', description: 'details', completed: false, closedReason: null } })])

    await applyPulledIssues({
      link: LINK,
      items: [issue({ completed: true, completedAt: '2026-08-15T08:30:00Z' })],
    })

    expect(updateTaskWithSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        actorId: 'user-1',
        intent: expect.objectContaining({
          completed: true,
          completedSource: 'github',
          completedAt: '2026-08-15T08:30:00Z',
        }),
      }),
    )
    expect(taskUpdate).not.toHaveBeenCalled()
  })

  it('reopens through the service too, so the stashed lane comes back', async () => {
    findMany.mockResolvedValue([existingLink({ ...newer, task: { title: 'Fix the thing', description: 'details', completed: true, closedReason: null } })])

    await applyPulledIssues({ link: LINK, items: [issue({ completed: false })] })

    expect(updateTaskWithSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({ intent: expect.objectContaining({ completed: false }) }),
    )
  })

  it('does not send completed at all when it has not changed — no re-stamp', async () => {
    findMany.mockResolvedValue([existingLink({ ...newer, task: { title: 'Old title', description: 'details', completed: true, closedReason: null } })])

    await applyPulledIssues({ link: LINK, items: [issue({ completed: true, title: 'New title' })] })

    const intent = updateTaskWithSideEffects.mock.calls[0][0].intent
    expect(intent).toEqual({ title: 'New title' })
  })

  it('writes nothing to the task when the issue content is unchanged, but still advances the link', async () => {
    findMany.mockResolvedValue([existingLink({ ...newer, task: { title: 'Fix the thing', description: 'details', completed: false, closedReason: null } })])

    const result = await applyPulledIssues({ link: LINK, items: [issue()] })

    expect(updateTaskWithSideEffects).not.toHaveBeenCalled()
    expect(linkUpdate).toHaveBeenCalled()
    expect(result).toMatchObject({ updated: 1 })
  })

  it('propagates a refused update so the cursor is not committed', async () => {
    findMany.mockResolvedValue([existingLink(newer)])
    updateTaskWithSideEffects.mockResolvedValue({ ok: false, status: 404, error: 'Task not found' })

    await expect(applyPulledIssues({ link: LINK, items: [issue()] })).rejects.toThrow('Task not found')
  })

  it('stamps completedSource on an issue imported already closed', async () => {
    await applyPulledIssues({ link: LINK, items: [issue({ completed: true, completedAt: '2026-08-15T08:30:00Z' })] })

    expect(createTaskWithSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          completed: true,
          completedSource: 'github',
          completedAt: '2026-08-15T08:30:00Z',
        }),
      }),
    )
  })
})

/**
 * AWTD-1123: an imported issue is CREATED through the task service.
 *
 * The raw `tx.task.create` gave an imported task no project identifier, no
 * reminders, no manual-sort entry and no task_created broadcast. The raw
 * write existed to keep the task and its ExternalTaskLink in one transaction,
 * because a task with no link is re-imported as a duplicate on the next run.
 * The service takes no transaction, so a stable clientRequestId per issue now
 * does that job: the retry gets the same task back and links it.
 */
describe('applyPulledIssues creates through the task service (AWTD-1123)', () => {
  it('never writes a task row itself', async () => {
    await applyPulledIssues({ link: LINK, items: [issue(), issue({ remoteId: 'owner/repo#2' })] })

    expect(taskCreate).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
    expect(createTaskWithSideEffects).toHaveBeenCalledTimes(2)
  })

  it('creates as the link owner, on the linked list, with the issue content', async () => {
    await applyPulledIssues({
      link: LINK,
      items: [issue({ completed: true, completedAt: '2026-08-15T08:30:00Z', closedReason: 'canceled' })],
    })

    expect(createTaskWithSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        input: expect.objectContaining({
          title: 'Fix the thing',
          description: 'details',
          listIds: ['list-1'],
          closedReason: 'canceled',
        }),
      }),
    )
  })

  it('leaves an issue with no resolved assignee unassigned, not on the list default', async () => {
    // `undefined` means "use the list's default assignee" to the service. The
    // raw write left these tasks unassigned, and import should keep doing that.
    await applyPulledIssues({ link: LINK, items: [issue()] })

    expect(createTaskWithSideEffects.mock.calls[0][0].input.assigneeId).toBeNull()
  })

  it('passes a resolved assignee through', async () => {
    await applyPulledIssues({
      link: LINK,
      items: [
        issue({
          metadata: {
            number: '1', parent: '', assigneeUserId: 'user-7', commentCount: '0',
            labels: '', assignees: '', state_reason: '',
          },
        }),
      ],
    })

    expect(createTaskWithSideEffects.mock.calls[0][0].input.assigneeId).toBe('user-7')
  })

  it('gives each issue a stable clientRequestId, distinct per issue and per user', async () => {
    await applyPulledIssues({ link: LINK, items: [issue()] })
    await applyPulledIssues({ link: LINK, items: [issue()] })
    await applyPulledIssues({ link: LINK, items: [issue({ remoteId: 'owner/repo#2' })] })
    await applyPulledIssues({ link: { ...LINK, userId: 'user-2' }, items: [issue()] })

    const ids = createTaskWithSideEffects.mock.calls.map(call => call[0].input.clientRequestId)
    expect(ids[0]).toBe(ids[1])
    expect(new Set([ids[0], ids[2], ids[3]]).size).toBe(3)
    // The service accepts 8 to 128 characters; a repo path can be longer.
    for (const id of ids) expect(id.length).toBeGreaterThanOrEqual(8)
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(128)
  })

  it('still yields a valid clientRequestId for a very long repo path', async () => {
    const longRemoteId = `${'o'.repeat(39)}/${'r'.repeat(100)}#123456`
    await applyPulledIssues({ link: LINK, items: [issue({ remoteId: longRemoteId })] })

    expect(createTaskWithSideEffects.mock.calls[0][0].input.clientRequestId.length).toBeLessThanOrEqual(128)
  })

  it('links the task a previous run created but never linked, rather than importing it twice', async () => {
    // The previous run created the task and died before the link write. The
    // cursor did not advance, so the issue comes back. The same clientRequestId
    // returns the same task, and this run links it.
    createTaskWithSideEffects.mockResolvedValue({ ok: true, task: { id: 'task-orphan' }, idempotent: true })

    const result = await applyPulledIssues({ link: LINK, items: [issue()] })

    expect(linkCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ astridTaskId: 'task-orphan' }) }),
    )
    expect(result).toMatchObject({ created: 1 })
  })

  it('propagates a refused create, writes no link, and so the cursor is not committed', async () => {
    createTaskWithSideEffects.mockResolvedValue({ ok: false, status: 403, error: 'No access to list' })

    await expect(applyPulledIssues({ link: LINK, items: [issue()] })).rejects.toThrow('No access to list')
    expect(linkCreate).not.toHaveBeenCalled()
  })
})

