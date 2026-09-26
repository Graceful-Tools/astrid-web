/**
 * AWTD-1002 follow-up — a card the blocker gate moves must move on every open
 * board, and the people it matters to must hear about it.
 *
 * The spec's reason for the completion trigger is "the user's own completion
 * should unblock the next card WHILE THEY ARE LOOKING AT THE BOARD". The gate
 * moved the row in the database and told nobody: no SSE, no cache
 * invalidation, no notification — so the card sat in Waiting until a refresh,
 * and "why did this move to Ready at 4am?" was answered only in a table no one
 * is notified from.
 *
 * Run against an in-memory fake of the two tables, because what is under test
 * is the sequence of writes and announcements, not Postgres.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type FakeTask = {
  id: string
  title: string
  identifier: string | null
  statusRole: string | null
  completed: boolean
  dueDateTime: Date | null
  creatorId: string | null
  assigneeId: string | null
  lists: Array<{ id: string; ownerId: string; listMembers: Array<{ userId: string }> }>
}
type FakeEdge = { blockedTaskId: string; blockingTaskId: string; createdAt: Date }

const db = vi.hoisted(() => ({
  tasks: new Map<string, any>(),
  edges: [] as any[],
}))

const broadcastToUsers = vi.hoisted(() => vi.fn())
const persistNotifications = vi.hoisted(() => vi.fn(async () => 0))
const recordTaskEvents = vi.hoisted(() => vi.fn(async () => {}))
const getTaskForUser = vi.hoisted(() => vi.fn())

function matchesEdge(edge: FakeEdge, where: Record<string, any>): boolean {
  if (where.blockedTaskId !== undefined && edge.blockedTaskId !== where.blockedTaskId) return false
  if (where.blockingTaskId !== undefined && edge.blockingTaskId !== where.blockingTaskId) return false
  if (where.blockingTask?.completed !== undefined) {
    if (db.tasks.get(edge.blockingTaskId)?.completed !== where.blockingTask.completed) return false
  }
  return true
}

function shapeEdge(edge: FakeEdge, select: Record<string, any>) {
  const out: Record<string, unknown> = {}
  if (select.blockingTaskId) out.blockingTaskId = edge.blockingTaskId
  if (select.blockedTaskId) out.blockedTaskId = edge.blockedTaskId
  if (select.blockingTask) out.blockingTask = { ...db.tasks.get(edge.blockingTaskId) }
  if (select.blockedTask) out.blockedTask = { ...db.tasks.get(edge.blockedTaskId) }
  return out
}

function matchesTask(task: FakeTask, where: Record<string, any>): boolean {
  if (where.id !== undefined && task.id !== where.id) return false
  if (where.statusRole !== undefined && task.statusRole !== where.statusRole) return false
  if (where.completed !== undefined && task.completed !== where.completed) return false
  return true
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskDependency: {
      findMany: vi.fn(async ({ where, select }: any) =>
        db.edges.filter(e => matchesEdge(e, where)).map(e => shapeEdge(e, select)),
      ),
      findUnique: vi.fn(async ({ where }: any) => {
        const key = where.blockedTaskId_blockingTaskId
        const found = db.edges.find(
          e => e.blockedTaskId === key.blockedTaskId && e.blockingTaskId === key.blockingTaskId,
        )
        return found ? { id: 'edge' } : null
      }),
      create: vi.fn(async ({ data }: any) => {
        db.edges.push({ ...data, createdAt: new Date() })
        return data
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = db.edges.length
        db.edges = db.edges.filter(e => !matchesEdge(e, where))
        return { count: before - db.edges.length }
      }),
    },
    task: {
      findUnique: vi.fn(async ({ where }: any) => {
        const task = db.tasks.get(where.id)
        return task ? { ...task } : null
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0
        for (const task of db.tasks.values()) {
          if (matchesTask(task, where)) {
            Object.assign(task, data)
            count += 1
          }
        }
        return { count }
      }),
      findMany: vi.fn(async () => []),
    },
  },
}))
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers, sendEventToUser: vi.fn() }))
vi.mock('@/lib/redis', () => ({
  isRedisAvailable: vi.fn(async () => false),
  RedisCache: { del: vi.fn(), keys: { userTasks: (id: string) => `tasks:${id}` } },
}))
vi.mock('@/lib/notification-store', () => ({ persistNotifications }))
vi.mock('@/lib/task-events', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordTaskEvents,
}))
vi.mock('@/lib/agent-protocol', () => ({ enrichTaskForAgent: (task: unknown) => task }))
vi.mock('@/services/task.service', () => ({ getTaskForUser }))

const BOARD = { id: 'board', ownerId: 'u-owner', listMembers: [{ userId: 'u-member' }] }

function task(id: string, overrides: Partial<FakeTask> = {}): FakeTask {
  return {
    id,
    title: id,
    identifier: null,
    statusRole: null,
    completed: false,
    dueDateTime: null,
    creatorId: 'u-creator',
    assigneeId: 'u-assignee',
    lists: [BOARD],
    ...overrides,
  }
}

function seed(tasks: FakeTask[], edges: Array<[blocked: string, blocking: string]>) {
  db.tasks.clear()
  for (const t of tasks) db.tasks.set(t.id, t)
  db.edges = edges.map(([blockedTaskId, blockingTaskId]) => ({
    blockedTaskId,
    blockingTaskId,
    createdAt: new Date(),
  }))
}

const broadcastsFor = (taskId: string) =>
  broadcastToUsers.mock.calls.filter(([, event]) => event?.data?.taskId === taskId)

const notifiedUserIds = () =>
  persistNotifications.mock.calls.flatMap(([args]: any) =>
    (args.targets as Array<{ userId: string }>).map(target => target.userId),
  )

beforeEach(() => {
  vi.clearAllMocks()
  getTaskForUser.mockImplementation(async (id: string) => ({
    ok: true,
    task: { ...db.tasks.get(id) },
  }))
})

describe('AWTD-1002 the board moves while you look at it', () => {
  it('completing the last blocker moves the waiting card to Ready on every open board', async () => {
    seed(
      [task('blocker', { completed: true }), task('dependent', { statusRole: 'waiting' })],
      [['dependent', 'blocker']],
    )
    const { promoteUnblockedDependents } = await import('@/services/task-dependency.service')

    const result = await promoteUnblockedDependents({
      blockingTaskId: 'blocker',
      actorId: 'u-actor',
      blockerCompleted: true,
    })

    expect(result.promoted).toEqual(['dependent'])
    expect(db.tasks.get('dependent').statusRole).toBe('ready')

    const [call] = broadcastsFor('dependent')
    expect(call, 'no SSE for the promoted card, so no open board moves it').toBeDefined()
    const [recipients, event] = call
    expect(event.type).toBe('task_updated')
    expect(event.data.task.statusRole).toBe('ready')
    expect(recipients).toEqual(
      expect.arrayContaining(['u-creator', 'u-assignee', 'u-owner', 'u-member']),
    )
  })

  it('notifies the dependent\'s people that it is ready — but not the person who unblocked it', async () => {
    seed(
      [task('blocker', { completed: true }), task('dependent', { statusRole: 'waiting' })],
      [['dependent', 'blocker']],
    )
    const { promoteUnblockedDependents } = await import('@/services/task-dependency.service')

    await promoteUnblockedDependents({
      blockingTaskId: 'blocker',
      actorId: 'u-assignee',
      blockerCompleted: true,
    })

    expect(notifiedUserIds()).toContain('u-creator')
    expect(notifiedUserIds()).not.toContain('u-assignee')
  })

  it('announces nothing when another blocker still holds the card', async () => {
    seed(
      [
        task('done-blocker', { completed: true }),
        task('open-blocker'),
        task('dependent', { statusRole: 'waiting' }),
      ],
      [['dependent', 'done-blocker'], ['dependent', 'open-blocker']],
    )
    const { promoteUnblockedDependents } = await import('@/services/task-dependency.service')

    await promoteUnblockedDependents({ blockingTaskId: 'done-blocker', blockerCompleted: true })

    expect(db.tasks.get('dependent').statusRole).toBe('waiting')
    expect(broadcastsFor('dependent')).toHaveLength(0)
    expect(persistNotifications).not.toHaveBeenCalled()
  })

  it('adding a blocker to a Ready card moves it to Waiting on the actor\'s own board too', async () => {
    // The actor did not drag this card: the server moved it as a CONSEQUENCE
    // of their write, so their board has no optimistic update to show it.
    seed([task('blocker'), task('dependent', { statusRole: 'ready', creatorId: 'u-actor' })], [])
    const { addBlocker } = await import('@/services/task-dependency.service')

    const result = await addBlocker({ taskId: 'dependent', blockingTaskId: 'blocker', userId: 'u-actor' })

    expect(result.ok).toBe(true)
    expect(db.tasks.get('dependent').statusRole).toBe('waiting')
    const [call] = broadcastsFor('dependent')
    expect(call).toBeDefined()
    expect(call[0]).toContain('u-actor')
    expect(call[1].data.task.statusRole).toBe('waiting')
  })

  it('reopening a blocker sends a Ready card back to Waiting, and says so', async () => {
    seed([task('blocker'), task('dependent', { statusRole: 'ready' })], [['dependent', 'blocker']])
    const { promoteUnblockedDependents } = await import('@/services/task-dependency.service')

    const result = await promoteUnblockedDependents({
      blockingTaskId: 'blocker',
      actorId: 'u-actor',
      blockerCompleted: false,
    })

    expect(result.reblocked).toEqual(['dependent'])
    expect(broadcastsFor('dependent')).toHaveLength(1)
    expect(notifiedUserIds()).toContain('u-assignee')
  })

  it('reopening a blocker under a card in Doing leaves the card and tells its assignee', async () => {
    // Spec: "left alone, with a TaskEvent and a notification to its assignee.
    // They are the only one who can judge whether the reopened blocker
    // actually stops them."
    seed([task('blocker'), task('dependent', { statusRole: 'doing' })], [['dependent', 'blocker']])
    const { promoteUnblockedDependents } = await import('@/services/task-dependency.service')

    const result = await promoteUnblockedDependents({
      blockingTaskId: 'blocker',
      actorId: 'u-actor',
      blockerCompleted: false,
    })

    expect(result.reblocked).toEqual([])
    expect(db.tasks.get('dependent').statusRole).toBe('doing')
    expect(recordTaskEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'dependent',
        events: [expect.objectContaining({ kind: 'blocker_reopened', to: { blockingTaskId: 'blocker' } })],
      }),
    )
    expect(notifiedUserIds()).toContain('u-assignee')
  })

  it('a reopened blocker under a finished card tells its assignee — the spec lists Done with Doing', async () => {
    seed(
      [task('blocker'), task('dependent', { statusRole: null, completed: true })],
      [['dependent', 'blocker']],
    )
    const { promoteUnblockedDependents } = await import('@/services/task-dependency.service')

    await promoteUnblockedDependents({ blockingTaskId: 'blocker', blockerCompleted: false })

    expect(db.tasks.get('dependent').completed).toBe(true)
    expect(notifiedUserIds()).toContain('u-assignee')
  })

  it('a reopened blocker says nothing new to a card that is still waiting', async () => {
    seed(
      [task('blocker'), task('dependent', { statusRole: 'waiting' })],
      [['dependent', 'blocker']],
    )
    const { promoteUnblockedDependents } = await import('@/services/task-dependency.service')

    await promoteUnblockedDependents({ blockingTaskId: 'blocker', blockerCompleted: false })

    expect(recordTaskEvents).not.toHaveBeenCalled()
    expect(persistNotifications).not.toHaveBeenCalled()
  })
})

describe('AWTD-1002 the picker is told what would cycle', () => {
  it('lists every task that transitively waits on this one — only the ones the reader may see', async () => {
    // far waits on near, near waits on self: self may wait on neither.
    seed([task('self'), task('near'), task('far')], [['near', 'self'], ['far', 'near']])
    getTaskForUser.mockImplementation(async (id: string) =>
      id === 'far' ? { ok: false, status: 404 } : { ok: true, task: { ...db.tasks.get(id) } },
    )
    const { getBlockersForTask } = await import('@/services/task-dependency.service')

    const lists = await getBlockersForTask('self', 'u-actor')

    expect(lists.dependentIds).toEqual(['near'])
  })
})
