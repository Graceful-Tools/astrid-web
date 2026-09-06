/**
 * Cross-surface contract test for the CREATE verb (epic 9dedd8aa).
 *
 * Four surfaces created tasks and no two of them did the same work. The
 * columns that matter are not style differences — they are guarantees that
 * were simply false depending on which door you came in through:
 *
 *   legacy app/api/tasks              mints identifiers, comments, reminders, manual sort
 *   v1     app/api/v1/tasks           mints identifiers, comments — no reminders, no manual sort
 *   MCP    operations/task-operations ❌ no identifier, no comment, no reminders, no manual sort
 *   MCP    mcp/handlers/tasks.ts      ❌ none of it, and no idempotency at all
 *
 * Two of those are the same class of bug as the missing DELETE tombstone:
 *
 *   - A task an agent creates in a project has NO `AST-nnn` identifier. Task
 *     5bcd426b fixed exactly this for v1's idempotent path; MCP misses it on
 *     every path, so the identifier a project's whole workflow keys on is
 *     absent for the creator that uses it most.
 *
 *   - A task an agent creates never enters a manually-sorted list's order, so
 *     it sorts nowhere until something unrelated rewrites that order.
 *
 * Whatever the surfaces do, they must now do it the same way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const taskCreate = vi.hoisted(() => vi.fn())
const taskFindUnique = vi.hoisted(() => vi.fn())
const taskFindFirst = vi.hoisted(() => vi.fn())
const taskListFindMany = vi.hoisted(() => vi.fn())
const userFindUnique = vi.hoisted(() => vi.fn())
const recordTaskCreationComment = vi.hoisted(() => vi.fn())
const allocateTaskIdentifier = vi.hoisted(() => vi.fn())
const syncManualSortMemberships = vi.hoisted(() => vi.fn())
const scheduleReminders = vi.hoisted(() => vi.fn())
const broadcastToUsers = vi.hoisted(() => vi.fn())
const trackAnalyticsEvent = vi.hoisted(() => vi.fn())
const notifyTaskAssignment = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { create: taskCreate, findUnique: taskFindUnique, findFirst: taskFindFirst },
    taskList: { findMany: taskListFindMany },
    user: { findUnique: userFindUnique },
  },
}))
vi.mock('@/lib/task-update-handler', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordTaskCreationComment,
}))
vi.mock('@/lib/task-identifier', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  allocateTaskIdentifier,
}))
vi.mock('@/lib/tasks/sync-manual-sort-memberships', () => ({ syncManualSortMemberships }))
vi.mock('@/lib/reminder-scheduling', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  scheduleReminders,
}))
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers, sendEventToUser: vi.fn() }))
vi.mock('@/lib/redis', () => ({
  RedisCache: {
    del: vi.fn(),
    keys: { userTasks: (id: string) => `tasks:${id}` },
    invalidate: { userTasks: vi.fn(), userListsAllVersions: vi.fn() },
  },
  isRedisAvailable: vi.fn(async () => false),
}))
vi.mock('@/lib/analytics-events', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  trackAnalyticsEvent,
}))
vi.mock('@/lib/ai-agent-webhook-service', () => ({
  aiAgentWebhookService: { notifyTaskAssignment, notifyTaskAssignmentViaAIAgentId: vi.fn() },
}))

const PRIVATE_LIST = {
  id: 'list-1',
  name: 'Work',
  ownerId: 'creator-1',
  privacy: 'PRIVATE',
  publicListType: null,
  isVirtual: false,
  projectId: null,
  listType: null,
  sortBy: 'manual',
  defaultAssigneeId: undefined,
  owner: { id: 'creator-1', name: 'Creator', email: 'creator@example.com' },
  listMembers: [{ userId: 'member-1', role: 'EDITOR', user: { id: 'member-1' } }],
}

function createdTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    title: 'A task',
    description: '',
    priority: 0,
    completed: false,
    isPrivate: true,
    identifier: null,
    sequence: null,
    creatorId: 'creator-1',
    assigneeId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    dueDateTime: null,
    isAllDay: false,
    creator: { id: 'creator-1', name: 'Creator', email: 'creator@example.com' },
    assignee: null,
    lists: [PRIVATE_LIST],
    comments: [],
    attachments: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  taskListFindMany.mockResolvedValue([PRIVATE_LIST])
  taskFindUnique.mockResolvedValue(null)
  taskFindFirst.mockResolvedValue(null)
  userFindUnique.mockResolvedValue({ id: 'assignee-1', isAIAgent: false })
  allocateTaskIdentifier.mockResolvedValue(null)
  // Echo back what was written, the way Prisma does — a side effect that reads
  // the persisted row (reminders read dueDateTime) is testing nothing if the
  // mock always returns the same frozen task.
  taskCreate.mockImplementation(async ({ data }: any) =>
    createdTask({
      identifier: data.identifier ?? null,
      isPrivate: data.isPrivate,
      assigneeId: data.assigneeId ?? null,
      title: data.title,
      dueDateTime: data.dueDateTime ?? null,
      reminderTime: data.reminderTime ?? null,
      reminderType: data.reminderType ?? null,
    })
  )
})

async function service() {
  return await import('@/services/task.service')
}

describe('createTaskWithSideEffects (epic 9dedd8aa)', () => {
  it('mints a project identifier — including on the clientRequestId path', async () => {
    // Task 5bcd426b: minting below the idempotency branch meant every client
    // sending a clientRequestId (iOS does) got a task with no AST-nnn at all.
    allocateTaskIdentifier.mockResolvedValue({ identifier: 'AST-7', sequence: 7 })
    const { createTaskWithSideEffects } = await service()

    const result = await createTaskWithSideEffects({
      input: { title: 'A task', listIds: ['list-1'], clientRequestId: 'idem-key-12345' },
      actorId: 'creator-1',
    })

    expect(result.ok).toBe(true)
    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ identifier: 'AST-7', sequence: 7 }),
      })
    )
  })

  it('defaults isPrivate to true', async () => {
    // MCP defaulted it to false and quietly shared tasks that would have been
    // private through any other door (task fb94f2ee).
    const { createTaskWithSideEffects } = await service()

    await createTaskWithSideEffects({
      input: { title: 'A task', listIds: ['list-1'] },
      actorId: 'creator-1',
    })

    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPrivate: true }) })
    )
  })

  it('records the creation system comment on a genuine create', async () => {
    const { createTaskWithSideEffects } = await service()

    await createTaskWithSideEffects({
      input: { title: 'A task', listIds: ['list-1'] },
      actorId: 'creator-1',
      actorName: 'Creator',
    })

    expect(recordTaskCreationComment).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', creatorName: 'Creator' })
    )
  })

  it('returns the existing task on a clientRequestId hit without creating or re-commenting', async () => {
    taskFindUnique.mockResolvedValue(createdTask({ id: 'task-existing' }))
    const { createTaskWithSideEffects } = await service()

    const result = await createTaskWithSideEffects({
      input: { title: 'A task', listIds: ['list-1'], clientRequestId: 'idem-key-12345' },
      actorId: 'creator-1',
    })

    expect(result).toMatchObject({ ok: true, idempotent: true })
    expect(result.ok && result.task.id).toBe('task-existing')
    expect(taskCreate).not.toHaveBeenCalled()
    expect(recordTaskCreationComment).not.toHaveBeenCalled()
  })

  it('rejects a clientRequestId outside 8-128 characters', async () => {
    const { createTaskWithSideEffects } = await service()

    const result = await createTaskWithSideEffects({
      input: { title: 'A task', clientRequestId: 'short' },
      actorId: 'creator-1',
    })

    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(taskCreate).not.toHaveBeenCalled()
  })

  it('dedups a same-title create from the same user within the minute', async () => {
    taskFindFirst.mockResolvedValue(createdTask({ id: 'task-recent' }))
    const { createTaskWithSideEffects } = await service()

    const result = await createTaskWithSideEffects({
      input: { title: 'A task', listIds: ['list-1'] },
      actorId: 'creator-1',
    })

    expect(result).toMatchObject({ ok: true, idempotent: true })
    expect(taskCreate).not.toHaveBeenCalled()
  })

  it('requires a title', async () => {
    const { createTaskWithSideEffects } = await service()

    const result = await createTaskWithSideEffects({
      input: { title: '   ' },
      actorId: 'creator-1',
    })

    expect(result).toMatchObject({ ok: false, status: 400 })
  })

  it('rejects list ids that do not exist', async () => {
    taskListFindMany.mockResolvedValue([])
    const { createTaskWithSideEffects } = await service()

    const result = await createTaskWithSideEffects({
      input: { title: 'A task', listIds: ['missing-list'] },
      actorId: 'creator-1',
    })

    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(taskCreate).not.toHaveBeenCalled()
  })

  it('refuses a list the actor has no role on', async () => {
    // The owner RELATION counts as a member too, so a fixture that moves only
    // ownerId still grants the old owner access.
    taskListFindMany.mockResolvedValue([
      {
        ...PRIVATE_LIST,
        ownerId: 'someone-else',
        owner: { id: 'someone-else', name: 'Someone', email: 'someone@example.com' },
        listMembers: [],
      },
    ])
    const { createTaskWithSideEffects } = await service()

    const result = await createTaskWithSideEffects({
      input: { title: 'A task', listIds: ['list-1'] },
      actorId: 'creator-1',
    })

    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(taskCreate).not.toHaveBeenCalled()
  })

  it('forces a task in a copy-only PUBLIC list to be unassigned', async () => {
    // A copy-only public list is a template anyone can read; an assignee on it
    // publishes a real person's identity and means nothing once copied.
    taskListFindMany.mockResolvedValue([
      { ...PRIVATE_LIST, privacy: 'PUBLIC', publicListType: 'copy-only' },
    ])
    const { createTaskWithSideEffects } = await service()

    await createTaskWithSideEffects({
      input: { title: 'A task', listIds: ['list-1'], assigneeId: 'assignee-1' },
      actorId: 'creator-1',
    })

    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assigneeId: null }) })
    )
  })

  it('never connects a task to a virtual list', async () => {
    // Virtual lists are saved-filter views, not containers.
    taskListFindMany.mockResolvedValue([
      PRIVATE_LIST,
      { ...PRIVATE_LIST, id: 'list-virtual', isVirtual: true },
    ])
    const { createTaskWithSideEffects } = await service()

    await createTaskWithSideEffects({
      input: { title: 'A task', listIds: ['list-1', 'list-virtual'] },
      actorId: 'creator-1',
    })

    const connected = taskCreate.mock.calls[0][0].data.lists.connect
    expect(connected).toEqual([{ id: 'list-1' }])
  })

  it('appends the task to the manual-sort order of every list it lands in', async () => {
    const { createTaskWithSideEffects } = await service()

    await createTaskWithSideEffects({
      input: { title: 'A task', listIds: ['list-1'] },
      actorId: 'creator-1',
    })

    expect(syncManualSortMemberships).toHaveBeenCalledWith({
      taskId: 'task-1',
      previousListIds: [],
      requestedListIds: ['list-1'],
    })
  })

  it('schedules the automatic reminders for a due date', async () => {
    const { createTaskWithSideEffects } = await service()

    await createTaskWithSideEffects({
      input: { title: 'A task', listIds: ['list-1'], dueDateTime: '2026-12-01T10:00:00.000Z' },
      actorId: 'creator-1',
    })

    expect(scheduleReminders).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1' })
    )
  })

  it('tells the other list members, and not the creator', async () => {
    const { createTaskWithSideEffects } = await service()

    await createTaskWithSideEffects({
      input: { title: 'A task', listIds: ['list-1'] },
      actorId: 'creator-1',
    })

    expect(broadcastToUsers).toHaveBeenCalled()
    const recipients = broadcastToUsers.mock.calls.flatMap(call => call[0] as string[])
    expect(recipients).not.toContain('creator-1')
    expect(recipients).toContain('member-1')
  })

  it('notifies an AI-agent assignee so the agent actually starts', async () => {
    userFindUnique.mockResolvedValue({ id: 'agent-1', isAIAgent: true, aiAgentType: 'claude' })
    taskCreate.mockResolvedValue(createdTask({ assigneeId: 'agent-1' }))
    const { createTaskWithSideEffects } = await service()

    await createTaskWithSideEffects({
      input: { title: 'A task', listIds: ['list-1'], assigneeId: 'agent-1' },
      actorId: 'creator-1',
    })

    expect(notifyTaskAssignment).toHaveBeenCalledWith('task-1', 'agent-1')
  })

  it('records the analytics event for every surface, not just the HTTP ones', async () => {
    const { createTaskWithSideEffects } = await service()

    await createTaskWithSideEffects({
      input: { title: 'A task', listIds: ['list-1'] },
      actorId: 'creator-1',
      platform: 'API-other',
    })

    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'creator-1',
      expect.anything(),
      'API-other',
      expect.objectContaining({ taskId: 'task-1' })
    )
  })

  it('never lets a failing side effect fail the create', async () => {
    // The row exists and the caller was told it would. A missed reminder or a
    // stale sort order is an inconvenience, not a reason to report failure for
    // something that already happened.
    recordTaskCreationComment.mockRejectedValueOnce(new Error('comment table gone'))
    syncManualSortMemberships.mockRejectedValueOnce(new Error('redis gone'))
    scheduleReminders.mockRejectedValueOnce(new Error('queue gone'))
    const { createTaskWithSideEffects } = await service()

    const result = await createTaskWithSideEffects({
      input: { title: 'A task', listIds: ['list-1'], dueDateTime: '2026-12-01T10:00:00.000Z' },
      actorId: 'creator-1',
    })

    expect(result.ok).toBe(true)
    expect(taskCreate).toHaveBeenCalled()
  })

  it('returns the winner when a concurrent retry wins the unique constraint', async () => {
    const { Prisma } = await import('@prisma/client')
    taskCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' })
    )
    taskFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createdTask({ id: 'task-winner' }))
    const { createTaskWithSideEffects } = await service()

    const result = await createTaskWithSideEffects({
      input: { title: 'A task', listIds: ['list-1'], clientRequestId: 'idem-key-12345' },
      actorId: 'creator-1',
    })

    expect(result).toMatchObject({ ok: true, idempotent: true })
    expect(result.ok && result.task.id).toBe('task-winner')
  })

  it('409s when the clientRequestId belongs to someone else', async () => {
    const { Prisma } = await import('@prisma/client')
    taskCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' })
    )
    taskFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createdTask({ id: 'task-theirs', creatorId: 'someone-else' }))
    const { createTaskWithSideEffects } = await service()

    const result = await createTaskWithSideEffects({
      input: { title: 'A task', listIds: ['list-1'], clientRequestId: 'idem-key-12345' },
      actorId: 'creator-1',
    })

    expect(result).toMatchObject({ ok: false, status: 409 })
  })
})

describe('every create surface goes through the service (epic 9dedd8aa)', () => {
  it.each([
    'app/api/tasks/route.ts',
    'app/api/v1/tasks/route.ts',
    'app/api/mcp/operations/handlers/task-operations.ts',
    'mcp/handlers/tasks.ts',
  ])('%s does not hand-roll the create', async (file) => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), file), 'utf8')

    // One implementation per verb: no surface calls prisma.task.create itself.
    expect(src).not.toMatch(/prisma\.task\.create\(/)
    expect(src).toMatch(/createTaskWithSideEffects/)
  })
})
