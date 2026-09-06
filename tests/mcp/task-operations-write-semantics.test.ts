/**
 * RED for task fb94f2ee — the MCP task handlers diverge from every other write
 * surface in two ways that are outright bugs, not just inconsistencies:
 *
 * 1. updateTask writes a `when` column alongside `dueDateTime`. That column no
 *    longer exists on the Task model, so Prisma rejects the whole update with
 *    "Unknown argument `when`" — every MCP due-date change throws. TypeScript
 *    misses it because spreading a conditional object suppresses excess
 *    property checking.
 *
 * 2. createTask defaults isPrivate to FALSE. The schema default, the legacy
 *    create route and both v1 create paths all default it to TRUE, so a task
 *    created over MCP is shared with the list when the same call anywhere else
 *    would have kept it private.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const taskUpdate = vi.hoisted(() => vi.fn())
const taskCreate = vi.hoisted(() => vi.fn())
const taskFindFirst = vi.hoisted(() => vi.fn())
const listFindMany = vi.hoisted(() => vi.fn())
const resolveMCPActor = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { update: taskUpdate, create: taskCreate, findFirst: taskFindFirst },
    taskList: { findMany: listFindMany },
  },
}))
vi.mock('@/app/api/mcp/operations/handlers/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveMCPActor,
  getListMemberIdsByListId: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))

const ACTOR = { userId: 'user-1', id: 'token-1' }

beforeEach(() => {
  vi.clearAllMocks()
  resolveMCPActor.mockResolvedValue(ACTOR)
  taskFindFirst.mockResolvedValue({ id: 'task-1', creatorId: 'user-1', lists: [] })
  taskUpdate.mockResolvedValue({ id: 'task-1', lists: [] })
  taskCreate.mockResolvedValue({ id: 'task-1', lists: [] })
  listFindMany.mockResolvedValue([])
})

describe('MCP updateTask (task fb94f2ee)', () => {
  it('does not write the removed `when` column when the due date changes', async () => {
    const { updateTask } = await import('@/app/api/mcp/operations/handlers/task-operations')

    await updateTask('token', 'task-1', { dueDateTime: '2026-09-09T10:00:00.000Z' }, 'user-1')

    expect(taskUpdate).toHaveBeenCalled()
    const data = taskUpdate.mock.calls[0][0].data
    expect(data).not.toHaveProperty('when')
    expect(data.dueDateTime).toEqual(new Date('2026-09-09T10:00:00.000Z'))
  })

  it('still clears the due date when passed null', async () => {
    const { updateTask } = await import('@/app/api/mcp/operations/handlers/task-operations')

    await updateTask('token', 'task-1', { dueDateTime: null }, 'user-1')

    const data = taskUpdate.mock.calls[0][0].data
    expect(data).not.toHaveProperty('when')
    expect(data.dueDateTime).toBeNull()
  })
})

describe('MCP createTask (task fb94f2ee)', () => {
  it('defaults isPrivate to true, like the schema and every other create path', async () => {
    const { createTask } = await import('@/app/api/mcp/operations/handlers/task-operations')

    await createTask('token', [], { title: 'A task' }, 'user-1')

    expect(taskCreate).toHaveBeenCalled()
    expect(taskCreate.mock.calls[0][0].data.isPrivate).toBe(true)
  })

  it('still honours an explicit isPrivate: false', async () => {
    const { createTask } = await import('@/app/api/mcp/operations/handlers/task-operations')

    await createTask('token', [], { title: 'A task', isPrivate: false }, 'user-1')

    expect(taskCreate.mock.calls[0][0].data.isPrivate).toBe(false)
  })
})
