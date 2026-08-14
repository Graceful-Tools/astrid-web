/**
 * Task e0613ae5 — batch copy (one task → several lists), shared by
 * POST /api/tasks/copy and POST /api/v1/tasks/copy.
 *
 * The two routes were line-for-line identical; these tests pin the behaviour
 * that was already there. The assignee resolution gets the most attention
 * because `defaultAssigneeId` is a three-way setting whose `null` and
 * `"unassigned"` cases mean opposite things, and an extraction is exactly
 * where that would get flattened.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn(), create: vi.fn() },
    taskList: { findMany: vi.fn() },
  },
}))

import { batchCopyTask } from '@/lib/task-batch-copy'
import { prisma } from '@/lib/prisma'

const mockPrisma = vi.mocked(prisma)
const USER = 'user-1'

function baseArgs(overrides: Record<string, unknown> = {}) {
  return {
    userId: USER,
    taskId: 'task-1',
    targetListIds: ['list-a'],
    assigneeProvided: false,
    ...overrides,
  }
}

function sourceTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1', title: 'T', description: null, priority: 1,
    repeating: null, isPrivate: false, dueDateTime: null, isAllDay: false,
    assigneeId: null, creatorId: USER,
    lists: [{ id: 'src', ownerId: USER, privacy: 'PRIVATE' }],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.task.findUnique.mockResolvedValue(sourceTask() as never)
  mockPrisma.taskList.findMany.mockResolvedValue(
    [{ id: 'list-a', name: 'A', ownerId: USER, defaultAssigneeId: null }] as never
  )
  mockPrisma.task.create.mockResolvedValue({ id: 'copy-1' } as never)
})

describe('batchCopyTask (task e0613ae5)', () => {
  it('rejects a request with no taskId or no target lists', async () => {
    expect(await batchCopyTask(baseArgs({ taskId: undefined })))
      .toMatchObject({ ok: false, status: 400 })
    expect(await batchCopyTask(baseArgs({ targetListIds: [] })))
      .toMatchObject({ ok: false, status: 400 })
    expect(mockPrisma.task.create).not.toHaveBeenCalled()
  })

  it('404s on a task that does not exist', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null as never)

    expect(await batchCopyTask(baseArgs())).toMatchObject({ ok: false, status: 404 })
  })

  it('forbids copying a private task the caller has no relationship to', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(
      sourceTask({ creatorId: 'someone-else', lists: [{ id: 'src', ownerId: 'someone-else', privacy: 'PRIVATE' }] }) as never
    )

    expect(await batchCopyTask(baseArgs())).toMatchObject({ ok: false, status: 403, error: 'Forbidden' })
    expect(mockPrisma.task.create).not.toHaveBeenCalled()
  })

  it('allows copying a stranger\'s task when it sits on a PUBLIC list', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(
      sourceTask({ creatorId: 'someone-else', lists: [{ id: 'src', ownerId: 'someone-else', privacy: 'PUBLIC' }] }) as never
    )

    expect((await batchCopyTask(baseArgs())).ok).toBe(true)
  })

  it('re-privatises a public list\'s task when the task itself is private', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(
      sourceTask({ creatorId: 'someone-else', isPrivate: true, lists: [{ id: 'src', ownerId: 'someone-else', privacy: 'PUBLIC' }] }) as never
    )

    expect(await batchCopyTask(baseArgs())).toMatchObject({ ok: false, status: 403 })
  })

  it('forbids the whole copy when ANY target list is inaccessible', async () => {
    // findMany returns only the reachable ones, so a short result means at
    // least one target was denied — and none of them get written.
    mockPrisma.taskList.findMany.mockResolvedValue(
      [{ id: 'list-a', name: 'A', ownerId: USER, defaultAssigneeId: null }] as never
    )

    const result = await batchCopyTask(baseArgs({ targetListIds: ['list-a', 'list-b'] }))

    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(mockPrisma.task.create).not.toHaveBeenCalled()
  })

  describe('assignee resolution', () => {
    const assigneeOf = () =>
      (mockPrisma.task.create.mock.calls[0][0] as never as { data: { assigneeId: string | null } }).data.assigneeId

    it('honours an explicit assigneeId', async () => {
      await batchCopyTask(baseArgs({ assigneeProvided: true, assigneeId: 'someone' }))
      expect(assigneeOf()).toBe('someone')
    })

    it('honours an explicit null assignee over the list default', async () => {
      // An explicit null means "nobody" and must not fall through to the
      // list's default — which is why the caller passes assigneeProvided
      // instead of us testing assigneeId for null.
      mockPrisma.taskList.findMany.mockResolvedValue(
        [{ id: 'list-a', name: 'A', ownerId: USER, defaultAssigneeId: 'default-person' }] as never
      )

      await batchCopyTask(baseArgs({ assigneeProvided: true, assigneeId: null }))

      expect(assigneeOf()).toBeNull()
    })

    it('treats a null list default as "the copier"', async () => {
      await batchCopyTask(baseArgs())
      expect(assigneeOf()).toBe(USER)
    })

    it('treats the literal "unassigned" default as nobody', async () => {
      mockPrisma.taskList.findMany.mockResolvedValue(
        [{ id: 'list-a', name: 'A', ownerId: USER, defaultAssigneeId: 'unassigned' }] as never
      )

      await batchCopyTask(baseArgs())

      expect(assigneeOf()).toBeNull()
    })

    it('uses a specific list default assignee', async () => {
      mockPrisma.taskList.findMany.mockResolvedValue(
        [{ id: 'list-a', name: 'A', ownerId: USER, defaultAssigneeId: 'default-person' }] as never
      )

      await batchCopyTask(baseArgs())

      expect(assigneeOf()).toBe('default-person')
    })

    it('takes the default from the FIRST target list only', async () => {
      mockPrisma.taskList.findMany.mockResolvedValue([
        { id: 'list-a', name: 'A', ownerId: USER, defaultAssigneeId: 'first-default' },
        { id: 'list-b', name: 'B', ownerId: USER, defaultAssigneeId: 'second-default' },
      ] as never)

      await batchCopyTask(baseArgs({ targetListIds: ['list-a', 'list-b'] }))

      expect(assigneeOf()).toBe('first-default')
    })
  })

  it('connects the copy to every target list and records its origin', async () => {
    mockPrisma.taskList.findMany.mockResolvedValue([
      { id: 'list-a', name: 'A', ownerId: USER, defaultAssigneeId: null },
      { id: 'list-b', name: 'B', ownerId: USER, defaultAssigneeId: null },
    ] as never)

    await batchCopyTask(baseArgs({ targetListIds: ['list-a', 'list-b'] }))

    const data = (mockPrisma.task.create.mock.calls[0][0] as never as {
      data: Record<string, unknown>
    }).data
    expect(data.lists).toEqual({ connect: [{ id: 'list-a' }, { id: 'list-b' }] })
    expect(data.originalTaskId).toBe('task-1')
    expect(data.sourceListId).toBe('src')
    expect(data.creatorId).toBe(USER)
  })
})
