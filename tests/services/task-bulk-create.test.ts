/**
 * AWTD-1124 — the bulk CREATE path, so copies stop writing raw rows.
 *
 * lib/copy-utils.ts and lib/task-batch-copy.ts created copied tasks straight
 * on the rows: no identifier, no reminders, no manual-sort membership, no
 * live event. Routing each through createTaskWithSideEffects would make a
 * 500-task list copy pay 500 rounds of side effects, so the batch pays them
 * once: one identifier range per project, one membership + manual-sort write
 * per list, reminders in one insert.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const tx = vi.hoisted(() => ({
  task: { createMany: vi.fn(), findMany: vi.fn() },
  taskList: { findMany: vi.fn(), update: vi.fn() },
  comment: { createMany: vi.fn() },
  reminderQueue: { createMany: vi.fn() },
  user: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: tx }))

const allocateSequenceRange = vi.hoisted(() => vi.fn())
const ensureProjectKey = vi.hoisted(() => vi.fn())
vi.mock('@/lib/task-identifier', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  allocateSequenceRange,
  ensureProjectKey,
}))

const broadcastToUsers = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers }))
const broadcastListEvent = vi.hoisted(() => vi.fn())
vi.mock('@/lib/lists/v1-list-shape', () => ({ broadcastListEvent }))
const dispatchAgentAssignment = vi.hoisted(() => vi.fn())
vi.mock('@/services/agent-assignment-dispatch', () => ({ dispatchAgentAssignment }))
vi.mock('@/lib/redis', () => ({
  RedisCache: { invalidate: { userTasks: vi.fn(), userListsAllVersions: vi.fn() } },
  isRedisAvailable: vi.fn(async () => false),
}))

import { createTasksInBulk } from '@/services/task-bulk-create'

const ACTOR = 'user-1'
const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000)

function row(title: string, extra: Record<string, unknown> = {}) {
  return { data: { title, description: '', priority: 0, ...extra }, listIds: ['list-p'] }
}

beforeEach(() => {
  vi.clearAllMocks()
  tx.$transaction.mockImplementation(async (fn: (client: typeof tx) => unknown) => fn(tx))
  tx.taskList.findMany.mockResolvedValue([
    { id: 'list-p', projectId: 'proj-1', sortBy: 'manual', manualSortOrder: ['old-1'] },
  ])
  tx.taskList.update.mockResolvedValue({ id: 'list-p', ownerId: ACTOR, listMembers: [] })
  tx.task.createMany.mockResolvedValue({ count: 0 })
  tx.comment.createMany.mockResolvedValue({ count: 0 })
  tx.reminderQueue.createMany.mockResolvedValue({ count: 0 })
  tx.user.findUnique.mockResolvedValue({ name: 'Jon', email: 'jon@example.com' })
  // Refetch echoes back whatever was inserted, with the relations the result promises.
  tx.task.findMany.mockImplementation(async () =>
    tx.task.createMany.mock.calls[0][0].data.map((data: Record<string, unknown>) => ({
      ...data,
      reminderTime: data.reminderTime ?? null,
      dueDateTime: data.dueDateTime ?? null,
      assignee: null,
      creator: { id: ACTOR, name: 'Jon' },
      lists: [{ id: 'list-p', name: 'P', ownerId: ACTOR, listMembers: [] }],
      comments: [],
      attachments: [],
    })),
  )
  ensureProjectKey.mockResolvedValue('AST')
  allocateSequenceRange.mockResolvedValue({ firstSequence: 41, key: 'AST' })
})

describe('createTasksInBulk (AWTD-1124)', () => {
  it('mints one identifier range per project, not one allocation per task', async () => {
    const { tasks } = await createTasksInBulk({
      actorId: ACTOR,
      tasks: [row('a'), row('b'), row('c')],
    })

    expect(allocateSequenceRange).toHaveBeenCalledTimes(1)
    expect(allocateSequenceRange).toHaveBeenCalledWith('proj-1', 3, tx)
    expect(tasks.map(t => t.identifier)).toEqual(['AST-41', 'AST-42', 'AST-43'])
    expect(tasks.map(t => t.sequence)).toEqual([41, 42, 43])
  })

  it('inserts every row in one statement and writes each list once, appending to its manual order', async () => {
    await createTasksInBulk({ actorId: ACTOR, tasks: [row('a'), row('b')] })

    expect(tx.task.createMany).toHaveBeenCalledTimes(1)
    const ids = tx.task.createMany.mock.calls[0][0].data.map((d: { id: string }) => d.id)
    expect(new Set(ids).size).toBe(2)

    expect(tx.taskList.update).toHaveBeenCalledTimes(1)
    expect(tx.taskList.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'list-p' },
      data: {
        tasks: { connect: ids.map((id: string) => ({ id })) },
        manualSortOrder: ['old-1', ...ids],
      },
    })
  })

  it('writes the creator as the actor and records a creation comment per task, plus carried history', async () => {
    await createTasksInBulk({
      actorId: ACTOR,
      tasks: [{ ...row('a'), comments: [{ content: 'kept', authorId: 'someone' }] }, row('b')],
    })

    const inserted = tx.task.createMany.mock.calls[0][0].data
    expect(inserted.every((d: { creatorId: string }) => d.creatorId === ACTOR)).toBe(true)

    expect(tx.comment.createMany).toHaveBeenCalledTimes(1)
    const comments = tx.comment.createMany.mock.calls[0][0].data
    expect(comments).toHaveLength(3)
    expect(comments.filter((c: { authorId: string | null }) => c.authorId === null)).toHaveLength(2)
    expect(comments).toContainEqual(
      expect.objectContaining({ taskId: inserted[0].id, content: 'kept', authorId: 'someone' }),
    )
  })

  it('schedules every reminder in one insert — automatic for a due date, explicit when set', async () => {
    await createTasksInBulk({
      actorId: ACTOR,
      tasks: [row('due', { dueDateTime: FUTURE }), row('explicit', { reminderTime: FUTURE }), row('none')],
    })

    expect(tx.reminderQueue.createMany).toHaveBeenCalledTimes(1)
    const reminders = tx.reminderQueue.createMany.mock.calls[0][0].data
    // due → 15-min-before + overdue; explicit → one; none → nothing.
    expect(reminders).toHaveLength(3)
    expect(reminders.every((r: { userId: string }) => r.userId === ACTOR)).toBe(true)
  })

  it('leaves a project-less task without an identifier and allocates nothing', async () => {
    tx.taskList.findMany.mockResolvedValue([
      { id: 'list-p', projectId: null, sortBy: 'createdAt', manualSortOrder: null },
    ])
    const { tasks } = await createTasksInBulk({ actorId: ACTOR, tasks: [row('a')] })

    expect(allocateSequenceRange).not.toHaveBeenCalled()
    expect(tasks[0].identifier ?? null).toBeNull()
    expect(tx.taskList.update.mock.calls[0][0].data.manualSortOrder).toBeUndefined()
  })

  it('creates nothing and touches nothing for an empty batch', async () => {
    expect(await createTasksInBulk({ actorId: ACTOR, tasks: [] })).toEqual({ tasks: [] })
    expect(tx.$transaction).not.toHaveBeenCalled()
  })

  it("sends task_created to the list's other members, never the actor", async () => {
    tx.task.findMany.mockImplementation(async () =>
      tx.task.createMany.mock.calls[0]?.[0]
        ? tx.task.createMany.mock.calls[0][0].data.map((data: Record<string, unknown>) => ({
            ...data,
            reminderTime: null,
            dueDateTime: null,
            creator: { id: ACTOR },
            // TASK_CREATE_INCLUDE's shape: owner and member users as relations.
            lists: [{
              id: 'list-p', name: 'P', owner: { id: 'owner-2' },
              listMembers: [{ userId: ACTOR, role: 'member', user: { id: ACTOR } }],
            }],
            comments: [],
          }))
        : [],
    )
    await createTasksInBulk({ actorId: ACTOR, tasks: [row('a')] })

    expect(broadcastToUsers).toHaveBeenCalledTimes(1)
    const [recipients, event] = broadcastToUsers.mock.calls[0]
    expect(event.type).toBe('task_created')
    expect(recipients).toContain('owner-2')
    expect(recipients).not.toContain(ACTOR)
  })

  it('sends no event for a copy into a list only the actor can see', async () => {
    await createTasksInBulk({ actorId: ACTOR, tasks: [row('a'), row('b')] })
    expect(broadcastToUsers).not.toHaveBeenCalled()
  })
})
