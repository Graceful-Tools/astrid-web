/**
 * AWTD-1118 (P6b): completing a repeating task on a GitHub board spawns the
 * NEXT issue instead of rolling the same row forward (spec §10).
 *
 * The pure planning is tests/lib/github-projects-recur.test.ts. What is pinned
 * here is the handoff, which is where the damage would be:
 *
 *   - a task on no GitHub board is not taken over, so a personal list still
 *     rolls forward;
 *   - a task on a board IS taken over, with one job per occurrence;
 *   - a duplicate insert still counts as taken over — that is the Astrid
 *     completion racing its own `issues.closed` webhook, and the whole point
 *     of the dedupe key is that exactly one of them spawns;
 *   - a queue insert that FAILS is not taken over, so the series rolls forward
 *     as it always did rather than being silently dropped;
 *   - a stale job (the series has already moved on) spawns nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  gitHubProjectItem: { findFirst: vi.fn(), findMany: vi.fn(), createMany: vi.fn() },
  gitHubSyncJob: { createMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/services/task-bulk-create', () => ({ createTasksInBulk: vi.fn(async () => ({ tasks: [] })) }))

import {
  enqueueRecurrenceForRemoteCompletions,
  enqueueRecurrenceSpawn,
  runRecurSpawn,
} from '@/services/github-recurrence.service'

const onABoard = () => db.gitHubProjectItem.findFirst.mockResolvedValue({ binding: { installationId: 42 } })

beforeEach(() => {
  vi.clearAllMocks()
  db.gitHubSyncJob.createMany.mockResolvedValue({ count: 1 })
  db.task.findUnique.mockResolvedValue({ occurrenceCount: 3 })
})

describe('handing a series over to GitHub (AWTD-1118)', () => {
  it('does not take over a task on no GitHub board', async () => {
    db.gitHubProjectItem.findFirst.mockResolvedValue(null)
    expect(await enqueueRecurrenceSpawn('task-1')).toBe(false)
    expect(db.gitHubSyncJob.createMany).not.toHaveBeenCalled()
  })

  it('takes over a task on a board, with one job keyed to this occurrence', async () => {
    onABoard()
    expect(await enqueueRecurrenceSpawn('task-1')).toBe(true)
    expect(db.gitHubSyncJob.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            kind: 'recur',
            installationId: 42,
            dedupeKey: 'recur:task-1:3',
            payload: { taskId: 'task-1', occurrenceCount: 3 },
          }),
        ],
        skipDuplicates: true,
      }),
    )
  })

  it('still counts as taken over when the webhook queued it first', async () => {
    onABoard()
    db.gitHubSyncJob.createMany.mockResolvedValue({ count: 0 })
    // A duplicate means the spawn is already in flight. Rolling forward here
    // would both roll the row forward AND spawn an issue.
    expect(await enqueueRecurrenceSpawn('task-1')).toBe(true)
  })

  it('rolls forward rather than dropping the series when the queue insert fails', async () => {
    onABoard()
    db.gitHubSyncJob.createMany.mockRejectedValue(new Error('queue unavailable'))
    expect(await enqueueRecurrenceSpawn('task-1')).toBe(false)
  })

  it('does not take over a task that has vanished', async () => {
    onABoard()
    db.task.findUnique.mockResolvedValue(null)
    expect(await enqueueRecurrenceSpawn('task-1')).toBe(false)
  })
})

describe('a close that happened on github.com (AWTD-1118)', () => {
  it('queues the next occurrence for each repeating task GitHub closed', async () => {
    db.task.findMany.mockResolvedValue([
      { id: 'task-1', occurrenceCount: 0 },
      { id: 'task-2', occurrenceCount: 7 },
    ])
    db.gitHubProjectItem.findMany.mockResolvedValue([
      { taskId: 'task-1', binding: { installationId: 42 } },
      { taskId: 'task-2', binding: { installationId: 42 } },
    ])

    expect(await enqueueRecurrenceForRemoteCompletions(['task-1', 'task-2'])).toBe(2)
    const keys = db.gitHubSyncJob.createMany.mock.calls.map(call => call[0].data[0].dedupeKey)
    expect(keys).toEqual(['recur:task-1:0', 'recur:task-2:7'])
  })

  it('asks the database nothing when GitHub closed nothing', async () => {
    expect(await enqueueRecurrenceForRemoteCompletions([])).toBe(0)
    expect(db.task.findMany).not.toHaveBeenCalled()
  })

  it('only considers tasks that are completed, repeating and not cancelled', async () => {
    db.task.findMany.mockResolvedValue([])
    await enqueueRecurrenceForRemoteCompletions(['task-1'])
    expect(db.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ completed: true, closedReason: null, repeating: { not: 'never' } }),
      }),
    )
  })
})

describe('running the spawn job (AWTD-1118)', () => {
  const client = { query: vi.fn() } as never

  const predecessor = (over: Record<string, unknown> = {}) => ({
    id: 'task-1',
    title: 'Water the plants',
    description: 'Every Monday',
    completed: true,
    completedAt: new Date('2026-10-05T10:00:00Z'),
    closedReason: null,
    repeating: 'weekly',
    repeatingData: null,
    repeatFrom: 'DUE_DATE',
    occurrenceCount: 3,
    dueDateTime: new Date('2026-10-05T00:00:00Z'),
    isAllDay: true,
    isPrivate: false,
    priority: 1,
    remoteNodeId: 'I_1',
    remoteKind: 'issue',
    assigneeId: null,
    assigneeIds: [],
    lists: [{ id: 'list-1' }],
    ...over,
  })

  it('spawns nothing when the series has already moved on', async () => {
    db.task.findUnique.mockResolvedValue(predecessor({ occurrenceCount: 4 }))
    await runRecurSpawn({ taskId: 'task-1', occurrenceCount: 3 }, 42, client)
    expect(db.gitHubProjectItem.findMany).not.toHaveBeenCalled()
  })

  it('spawns nothing for a task reopened since the job was queued', async () => {
    db.task.findUnique.mockResolvedValue(predecessor({ completed: false }))
    await runRecurSpawn({ taskId: 'task-1', occurrenceCount: 3 }, 42, client)
    expect(db.gitHubProjectItem.findMany).not.toHaveBeenCalled()
  })

  it('spawns nothing for an occurrence closed as not planned', async () => {
    db.task.findUnique.mockResolvedValue(predecessor({ closedReason: 'not_planned' }))
    await runRecurSpawn({ taskId: 'task-1', occurrenceCount: 3 }, 42, client)
    expect(db.gitHubProjectItem.findMany).not.toHaveBeenCalled()
  })

  it('spawns nothing for a pull request, which is never a recurring task', async () => {
    db.task.findUnique.mockResolvedValue(predecessor({ remoteKind: 'pull_request' }))
    await runRecurSpawn({ taskId: 'task-1', occurrenceCount: 3 }, 42, client)
    expect(db.gitHubProjectItem.findMany).not.toHaveBeenCalled()
  })

  it('ends the series without spawning when the count is used up', async () => {
    db.task.findUnique.mockResolvedValue(
      predecessor({
        repeating: 'custom',
        repeatingData: { type: 'custom', unit: 'weeks', interval: 1, endCondition: 'after', occurrences: 3 },
      }),
    )
    await runRecurSpawn({ taskId: 'task-1', occurrenceCount: 3 }, 42, client)
    expect(db.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'task-1' }, data: expect.objectContaining({ repeating: 'never' }) }),
    )
    expect(db.gitHubProjectItem.findMany).not.toHaveBeenCalled()
  })

  it('spawns nothing when the board it was on has been detached', async () => {
    db.task.findUnique.mockResolvedValue(predecessor())
    db.gitHubProjectItem.findMany.mockResolvedValue([])
    await runRecurSpawn({ taskId: 'task-1', occurrenceCount: 3 }, 42, client)
    expect((client as unknown as { query: ReturnType<typeof vi.fn> }).query).not.toHaveBeenCalled()
  })
})
