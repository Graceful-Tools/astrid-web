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
import { Prisma } from '@prisma/client'
import { unknownSelectFields } from '../utils/prisma-where'

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
import { createTasksInBulk } from '@/services/task-bulk-create'

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

  it('reads the predecessor’s boards with fields the schema has (AWTD-1284)', async () => {
    // Live on the lanes-test preview, every recur job failed on this query:
    // it selected binding.listId, which GitHubProjectBinding has never had.
    db.task.findUnique.mockResolvedValue(predecessor())
    db.gitHubProjectItem.findMany.mockResolvedValue([])
    await runRecurSpawn({ taskId: 'task-1', occurrenceCount: 3 }, 42, client)

    const { select } = db.gitHubProjectItem.findMany.mock.calls[0][0]
    expect(unknownSelectFields('GitHubProjectItem', select)).toEqual([])
  })

  it('keeps a spawned issue when GitHub refuses a field copy, so a retry cannot make another (AWTD-1284)', async () => {
    // Live on the lanes-test preview: the due field ("Target date") is a GitHub
    // ISSUE field, which updateProjectV2ItemFieldValue refuses. The job threw
    // after createIssue had succeeded, and every retry created another issue.
    db.task.findUnique.mockResolvedValue(predecessor())
    db.gitHubProjectItem.findMany.mockResolvedValue([
      {
        itemNodeId: 'PVTI_1',
        projectId: 'project-1',
        binding: {
          projectNodeId: 'PVT_1',
          installationId: 42,
          project: { ownerId: 'user-1' },
          statusFieldId: 'F_STATUS',
          statusOptionMap: { todo: 'ready', done: 'done' },
          priorityFieldId: null,
          priorityOptionMap: null,
          dueFieldId: 'F_DUE',
        },
      },
    ])
    vi.mocked(createTasksInBulk).mockResolvedValueOnce({ tasks: [{ id: 'task-2' }] } as never)
    const query = vi.fn(async (document: string, variables: Record<string, unknown> = {}) => {
      if (document.includes('SpawnSource')) {
        return {
          node: {
            __typename: 'Issue', id: 'I_1', title: 'Water the plants', body: null, number: 1,
            repository: { id: 'R_1', nameWithOwner: 'acme/garden' }, labels: { nodes: [] }, assignees: { nodes: [] },
          },
        }
      }
      if (document.includes('createIssue')) {
        return { m0: { issue: { id: 'I_2', number: 2, updatedAt: '2026-10-21T00:00:00Z', repository: { nameWithOwner: 'acme/garden' } } } }
      }
      if (document.includes('addProjectV2ItemById')) return { m0: { item: { id: 'PVTI_2' } } }
      if (variables.id === 'PVTI_1') return { node: { id: 'PVTI_1', fieldValues: { nodes: [] } } }
      if (document.includes('updateProjectV2ItemFieldValue')) {
        throw new Error('Issue field values cannot be updated using the updateProjectV2ItemFieldValue mutation')
      }
      return {}
    })

    await expect(runRecurSpawn({ taskId: 'task-1', occurrenceCount: 3 }, 42, { query } as never)).resolves.toBeUndefined()

    expect(query.mock.calls.filter(([document]) => document.includes('createIssue'))).toHaveLength(1)
    expect(db.gitHubProjectItem.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [{ itemNodeId: 'PVTI_2', projectId: 'project-1', taskId: 'task-2' }] }),
    )
    expect(db.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'task-1' }, data: expect.objectContaining({ repeating: 'never' }) }),
    )
  })

  it('gives the series to the successor the webhook already mirrored (AWTD-1284)', async () => {
    // Live on the lanes-test preview: GitHub's webhook for the new issue landed
    // while the job was still copying fields, so the successor was already a
    // plain mirrored task and the insert failed on its identifier, after the
    // issue existed. A retry would have created another issue.
    db.task.findUnique.mockResolvedValue(predecessor())
    db.gitHubProjectItem.findMany.mockResolvedValue([
      {
        itemNodeId: 'PVTI_1',
        projectId: 'project-1',
        binding: {
          projectNodeId: 'PVT_1', installationId: 42, project: { ownerId: 'user-1' },
          statusFieldId: 'F_STATUS', statusOptionMap: { todo: 'ready', done: 'done' },
          priorityFieldId: null, priorityOptionMap: null, dueFieldId: null,
        },
      },
    ])
    vi.mocked(createTasksInBulk).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`identifier`)', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    )
    db.task.update.mockResolvedValue({ id: 'task-mirrored' })
    const query = vi.fn(async (document: string, variables: Record<string, unknown> = {}) => {
      if (document.includes('SpawnSource')) {
        return {
          node: {
            __typename: 'Issue', id: 'I_1', title: 'Water the plants', body: null, number: 1,
            repository: { id: 'R_1', nameWithOwner: 'acme/garden' }, labels: { nodes: [] }, assignees: { nodes: [] },
          },
        }
      }
      if (document.includes('createIssue')) {
        return { m0: { issue: { id: 'I_2', number: 2, updatedAt: '2026-10-21T00:00:00Z', repository: { nameWithOwner: 'acme/garden' } } } }
      }
      if (document.includes('addProjectV2ItemById')) return { m0: { item: { id: 'PVTI_2' } } }
      if (variables.id === 'PVTI_1') return { node: { id: 'PVTI_1', fieldValues: { nodes: [] } } }
      return {}
    })

    await expect(runRecurSpawn({ taskId: 'task-1', occurrenceCount: 3 }, 42, { query } as never)).resolves.toBeUndefined()

    expect(db.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { remoteNodeId: 'I_2' },
        data: expect.objectContaining({ previousOccurrenceId: 'task-1', occurrenceCount: 4, repeating: 'weekly' }),
      }),
    )
    expect(db.gitHubProjectItem.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [{ itemNodeId: 'PVTI_2', projectId: 'project-1', taskId: 'task-mirrored' }] }),
    )
  })

  it('spawns nothing when the board it was on has been detached', async () => {
    db.task.findUnique.mockResolvedValue(predecessor())
    db.gitHubProjectItem.findMany.mockResolvedValue([])
    await runRecurSpawn({ taskId: 'task-1', occurrenceCount: 3 }, 42, client)
    expect((client as unknown as { query: ReturnType<typeof vi.fn> }).query).not.toHaveBeenCalled()
  })
})
