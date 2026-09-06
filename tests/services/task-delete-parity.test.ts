/**
 * Cross-surface contract test for the DELETE verb (epic 9dedd8aa).
 *
 * The epic says create first. This takes delete first, because delete's
 * divergence is not an inconsistency — it is a broken guarantee:
 *
 *   legacy app/api/tasks/[id]          records a tombstone ✅
 *   v1     app/api/v1/tasks/[id]       records a tombstone ✅
 *   MCP    operations/task-operations  hard-deletes, no tombstone ❌
 *   MCP    mcp/handlers/tasks.ts       hard-deletes, no tombstone ❌
 *
 * lib/deletion-log.ts exists so `updatedSince` is safe to act on. Without a
 * tombstone a task deleted over MCP is invisible to every delta-syncing client
 * FOREVER — iOS and Mac keep showing it until a full refetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const taskDelete = vi.hoisted(() => vi.fn())
const taskFindUnique = vi.hoisted(() => vi.fn())
const recordDeletion = vi.hoisted(() => vi.fn())
const cancelActiveCodingWorkflow = vi.hoisted(() => vi.fn())
const syncManualSortMemberships = vi.hoisted(() => vi.fn())
const broadcastToUsers = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: { task: { delete: taskDelete, findUnique: taskFindUnique } },
}))
vi.mock('@/lib/deletion-log', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordDeletion,
}))
vi.mock('@/lib/tasks/cancel-active-coding-workflow', () => ({ cancelActiveCodingWorkflow }))
vi.mock('@/lib/tasks/sync-manual-sort-memberships', () => ({ syncManualSortMemberships }))
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers, sendEventToUser: vi.fn() }))

const TASK = {
  id: 'task-1',
  title: 'A task',
  creatorId: 'creator-1',
  assigneeId: 'assignee-1',
  lists: [
    {
      id: 'list-1',
      name: 'Work',
      ownerId: 'owner-1',
      listMembers: [{ userId: 'member-1' }],
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  taskFindUnique.mockResolvedValue({ ...TASK })
  taskDelete.mockResolvedValue({ ...TASK })
  cancelActiveCodingWorkflow.mockResolvedValue({ cancelled: false })
})

describe('deleteTaskWithSideEffects (epic 9dedd8aa)', () => {
  it('records a tombstone so delta-syncing clients learn the task is gone', async () => {
    const { deleteTaskWithSideEffects } = await import('@/services/task.service')

    await deleteTaskWithSideEffects({ taskId: 'task-1', actorId: 'creator-1' })

    expect(taskDelete).toHaveBeenCalledWith({ where: { id: 'task-1' } })
    expect(recordDeletion).toHaveBeenCalledWith('task', 'task-1', expect.any(Array))
  })

  it('gives the tombstone the audience that could see the task', async () => {
    // An id is information: it is only ever handed to someone who already knew
    // the task existed.
    const { deleteTaskWithSideEffects } = await import('@/services/task.service')

    await deleteTaskWithSideEffects({ taskId: 'task-1', actorId: 'creator-1' })

    const audience = recordDeletion.mock.calls[0][2] as string[]
    expect(audience).toEqual(expect.arrayContaining(['creator-1', 'assignee-1', 'owner-1', 'member-1']))
  })

  it('captures the audience BEFORE the row goes, not after', async () => {
    // The relations go with the row, so reading them afterwards yields nobody
    // and the tombstone reaches no one.
    const order: string[] = []
    taskFindUnique.mockImplementation(async () => {
      order.push('read')
      return { ...TASK }
    })
    taskDelete.mockImplementation(async () => {
      order.push('delete')
      return { ...TASK }
    })
    const { deleteTaskWithSideEffects } = await import('@/services/task.service')

    await deleteTaskWithSideEffects({ taskId: 'task-1', actorId: 'creator-1' })

    expect(order.indexOf('read')).toBeLessThan(order.indexOf('delete'))
  })

  it('cancels an in-flight coding workflow before deleting', async () => {
    const { deleteTaskWithSideEffects } = await import('@/services/task.service')

    await deleteTaskWithSideEffects({ taskId: 'task-1', actorId: 'creator-1' })

    expect(cancelActiveCodingWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1' })
    )
  })

  it('drops the task out of every manual-sort order it was in', async () => {
    const { deleteTaskWithSideEffects } = await import('@/services/task.service')

    await deleteTaskWithSideEffects({ taskId: 'task-1', actorId: 'creator-1' })

    expect(syncManualSortMemberships).toHaveBeenCalledWith({
      taskId: 'task-1',
      previousListIds: ['list-1'],
      requestedListIds: [],
    })
  })

  it('tells the other viewers, and not the deleter', async () => {
    const { deleteTaskWithSideEffects } = await import('@/services/task.service')

    await deleteTaskWithSideEffects({ taskId: 'task-1', actorId: 'creator-1' })

    expect(broadcastToUsers).toHaveBeenCalled()
    const recipients = broadcastToUsers.mock.calls[0][0] as string[]
    expect(recipients).not.toContain('creator-1')
    expect(recipients).toEqual(expect.arrayContaining(['assignee-1', 'owner-1', 'member-1']))
  })

  it('never lets a failing side effect fail the delete', async () => {
    // The user asked for the row to go, and it has. A tombstone failure is a
    // sync inconvenience, not a reason to report failure for something that
    // already happened.
    recordDeletion.mockRejectedValueOnce(new Error('tombstone table gone'))
    syncManualSortMemberships.mockRejectedValueOnce(new Error('redis gone'))
    const { deleteTaskWithSideEffects } = await import('@/services/task.service')

    await expect(
      deleteTaskWithSideEffects({ taskId: 'task-1', actorId: 'creator-1' })
    ).resolves.toBeDefined()
    expect(taskDelete).toHaveBeenCalled()
  })

  it('reports the task was not there rather than throwing', async () => {
    taskFindUnique.mockResolvedValue(null)
    const { deleteTaskWithSideEffects } = await import('@/services/task.service')

    const result = await deleteTaskWithSideEffects({ taskId: 'gone', actorId: 'u1' })

    expect(result.deleted).toBe(false)
    expect(taskDelete).not.toHaveBeenCalled()
  })
})

describe('every delete surface goes through the service (epic 9dedd8aa)', () => {
  it.each([
    'app/api/tasks/[id]/route.ts',
    'app/api/v1/tasks/[id]/route.ts',
    'app/api/mcp/operations/handlers/task-operations.ts',
    'mcp/handlers/tasks.ts',
  ])('%s does not hand-roll the delete', async (file) => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), file), 'utf8')

    // One implementation per verb: no surface calls prisma.task.delete itself.
    expect(src).not.toMatch(/prisma\.task\.delete\(/)
    expect(src).toMatch(/deleteTaskWithSideEffects/)
  })
})
