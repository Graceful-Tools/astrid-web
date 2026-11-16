/**
 * AWTD-1686 — handoff as a command: file the other half on another list, and get the task back
 * when it is done.
 *
 * The bug it fixes: adding a blocker unassigns the source (Waiting rule R2), so when the other half
 * completed the source woke to Ready with NOBODY on it, and the agent that started the work lost it.
 * Under test is the round trip — handoff, the half completing, the source waking back to its
 * holder — against an in-memory fake of the two tables, with the real Waiting rules
 * (lib/waiting-rules.ts, the TypeScript mirror of astrid-core R8) deciding.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  tasks: new Map<string, any>(),
  edges: [] as Array<{ blockedTaskId: string; blockingTaskId: string; createdAt: Date }>,
  nextId: 1,
}))

const createTaskWithSideEffects = vi.hoisted(() => vi.fn())
const dispatchAgentAssignment = vi.hoisted(() => vi.fn(async () => {}))
const recordTaskEvents = vi.hoisted(() => vi.fn(async () => {}))

function matchesTask(task: any, where: Record<string, any>): boolean {
  for (const key of ['id', 'statusRole', 'completed', 'assigneeId', 'dueDateTime'] as const) {
    if (where[key] !== undefined && (task[key] ?? null) !== where[key]) return false
  }
  return true
}

function pick(row: any, select?: Record<string, any>) {
  if (!row) return null
  if (!select) return { ...row }
  return Object.fromEntries(Object.keys(select).map(key => [key, row[key] ?? null]))
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskDependency: {
      findMany: vi.fn(async ({ where, select }: any) =>
        db.edges
          .filter(edge =>
            (where.blockedTaskId === undefined || edge.blockedTaskId === where.blockedTaskId) &&
            (where.blockingTaskId === undefined || edge.blockingTaskId === where.blockingTaskId))
          .map(edge => ({
            ...(select.blockingTaskId ? { blockingTaskId: edge.blockingTaskId } : {}),
            ...(select.blockedTaskId ? { blockedTaskId: edge.blockedTaskId } : {}),
            ...(select.blockingTask ? { blockingTask: { ...db.tasks.get(edge.blockingTaskId) } } : {}),
            ...(select.blockedTask ? { blockedTask: { ...db.tasks.get(edge.blockedTaskId) } } : {}),
          })),
      ),
      findUnique: vi.fn(async ({ where }: any) => {
        const key = where.blockedTaskId_blockingTaskId
        return db.edges.some(e => e.blockedTaskId === key.blockedTaskId && e.blockingTaskId === key.blockingTaskId)
          ? { id: 'edge' }
          : null
      }),
      create: vi.fn(async ({ data }: any) => {
        db.edges.push({ ...data, createdAt: new Date() })
        return data
      }),
    },
    task: {
      findUnique: vi.fn(async ({ where, select }: any) => pick(db.tasks.get(where.id), select)),
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
      update: vi.fn(async ({ where, data }: any) => Object.assign(db.tasks.get(where.id), data)),
      findMany: vi.fn(async () => []),
    },
    user: { findUnique: vi.fn(async () => ({ locale: 'en' })) },
  },
}))
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn(), sendEventToUser: vi.fn() }))
vi.mock('@/lib/redis', () => ({
  isRedisAvailable: vi.fn(async () => false),
  RedisCache: { del: vi.fn(), keys: { userTasks: (id: string) => `tasks:${id}` } },
}))
vi.mock('@/lib/notification-store', () => ({ persistNotifications: vi.fn(async () => 0) }))
vi.mock('@/lib/task-events', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordTaskEvents,
}))
vi.mock('@/lib/tasks/v1-task-shape', () => ({ loadV1TaskForEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/tasks/cancel-active-coding-workflow', () => ({ cancelActiveCodingWorkflow: vi.fn(async () => {}) }))
vi.mock('@/services/agent-assignment-dispatch', () => ({ dispatchAgentAssignment }))
vi.mock('@/services/task.service', () => ({
  createTaskWithSideEffects,
  getTaskForUser: vi.fn(async (id: string) => ({ ok: true, task: { ...db.tasks.get(id) } })),
}))

function seedTask(id: string, fields: Record<string, unknown> = {}) {
  db.tasks.set(id, {
    id,
    title: id,
    statusRole: null,
    completed: false,
    dueDateTime: null,
    isAllDay: false,
    assigneeId: null,
    assigneeIds: [],
    creatorId: 'u-jon',
    handoffReturnAssigneeId: null,
    lists: [],
    ...fields,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  db.tasks.clear()
  db.edges = []
  db.nextId = 1
  // The real create is the target list's permission check; here it files the half as asked.
  createTaskWithSideEffects.mockImplementation(async ({ input }: any) => {
    const id = `half-${db.nextId++}`
    seedTask(id, { title: input.title, statusRole: input.statusRole, assigneeId: input.assigneeId ?? null, listIds: input.listIds })
    return { ok: true, task: { ...db.tasks.get(id) }, idempotent: false }
  })
})

const AGENT = 'ai-agent-claude'

describe('AWTD-1686 handoff', () => {
  it('files the half Ready on the target list and parks the source in Waiting on it, remembering its holder', async () => {
    seedTask('src', { statusRole: 'doing', assigneeId: AGENT, assigneeIds: [AGENT] })
    const { handoffTask } = await import('@/services/task-handoff.service')

    const result = await handoffTask({ sourceTaskId: 'src', targetListId: 'ios-board', title: '[ios] the other half', actorId: AGENT, actorType: 'agent' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(createTaskWithSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ listIds: ['ios-board'], statusRole: 'ready', assigneeId: null, title: '[ios] the other half' }),
        actorId: AGENT,
      }),
    )
    expect(db.edges).toEqual([expect.objectContaining({ blockedTaskId: 'src', blockingTaskId: result.half.id })])
    const source = db.tasks.get('src')
    expect(source.statusRole).toBe('waiting')
    expect(source.assigneeId).toBeNull()
    expect(source.handoffReturnAssigneeId).toBe(AGENT)
    expect(result.returnAssigneeId).toBe(AGENT)
  })

  it('the half completing wakes the source to Ready, assigned back to the agent that handed it off', async () => {
    seedTask('src', { statusRole: 'doing', assigneeId: AGENT, assigneeIds: [AGENT] })
    const { handoffTask } = await import('@/services/task-handoff.service')
    const { promoteUnblockedDependents } = await import('@/services/task-dependency.service')
    const result = await handoffTask({ sourceTaskId: 'src', targetListId: 'ios-board', title: 'half', actorId: AGENT, actorType: 'agent' })
    if (!result.ok) throw new Error('handoff refused')

    db.tasks.get(result.half.id).completed = true
    const { promoted } = await promoteUnblockedDependents({ blockingTaskId: result.half.id, actorId: 'u-ios-agent', blockerCompleted: true })

    expect(promoted).toEqual(['src'])
    const source = db.tasks.get('src')
    expect(source.statusRole).toBe('ready')
    // In the agent's own queue — no includeUnassigned needed.
    expect(source.assigneeId).toBe(AGENT)
    expect(source.assigneeIds).toEqual([AGENT])
    expect(source.handoffReturnAssigneeId).toBeNull()
    expect(dispatchAgentAssignment).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'src', assigneeId: AGENT }))
  })

  it('somebody assigned during the wait keeps it', async () => {
    seedTask('src', { statusRole: 'doing', assigneeId: AGENT, assigneeIds: [AGENT] })
    const { handoffTask } = await import('@/services/task-handoff.service')
    const { promoteUnblockedDependents } = await import('@/services/task-dependency.service')
    const result = await handoffTask({ sourceTaskId: 'src', targetListId: 'ios-board', title: 'half', actorId: AGENT })
    if (!result.ok) throw new Error('handoff refused')

    Object.assign(db.tasks.get('src'), { assigneeId: 'u-jon', assigneeIds: ['u-jon'] })
    db.tasks.get(result.half.id).completed = true
    await promoteUnblockedDependents({ blockingTaskId: result.half.id, blockerCompleted: true })

    expect(db.tasks.get('src')).toMatchObject({ statusRole: 'ready', assigneeId: 'u-jon', handoffReturnAssigneeId: null })
  })

  it('refuses a finished source with HANDOFF_SOURCE_DONE and writes nothing', async () => {
    seedTask('src', { completed: true, assigneeId: AGENT })
    const { handoffTask } = await import('@/services/task-handoff.service')

    const result = await handoffTask({ sourceTaskId: 'src', targetListId: 'ios-board', title: 'half', actorId: AGENT })

    expect(result).toMatchObject({ ok: false, status: 409, code: 'HANDOFF_SOURCE_DONE' })
    if (!result.ok) expect(result.error).toBe('A finished task cannot be handed off. Reopen it first.')
    expect(createTaskWithSideEffects).not.toHaveBeenCalled()
    expect(db.edges).toEqual([])
  })

  it('a target list the caller may not add to refuses the create, and the source is untouched', async () => {
    seedTask('src', { statusRole: 'doing', assigneeId: AGENT })
    createTaskWithSideEffects.mockResolvedValueOnce({ ok: false, status: 403, error: "You don't have permission to create tasks in this list" })
    const { handoffTask } = await import('@/services/task-handoff.service')

    const result = await handoffTask({ sourceTaskId: 'src', targetListId: 'someone-elses', title: 'half', actorId: AGENT })

    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(db.edges).toEqual([])
    expect(db.tasks.get('src')).toMatchObject({ statusRole: 'doing', assigneeId: AGENT, handoffReturnAssigneeId: null })
  })

  it('a plain blocker still unassigns and remembers nobody (R2 unchanged outside a handoff)', async () => {
    seedTask('src', { statusRole: 'ready', assigneeId: AGENT, assigneeIds: [AGENT] })
    seedTask('other', {})
    const { addBlocker, promoteUnblockedDependents } = await import('@/services/task-dependency.service')

    await addBlocker({ taskId: 'src', blockingTaskId: 'other', userId: 'u-jon' })
    expect(db.tasks.get('src')).toMatchObject({ statusRole: 'waiting', assigneeId: null, handoffReturnAssigneeId: null })

    db.tasks.get('other').completed = true
    await promoteUnblockedDependents({ blockingTaskId: 'other', blockerCompleted: true })
    expect(db.tasks.get('src')).toMatchObject({ statusRole: 'ready', assigneeId: null })
  })
})
