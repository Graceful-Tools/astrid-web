import { describe, it, expect, beforeEach, vi } from 'vitest'

// Copies create through the bulk path (AWTD-1124); what matters here is what
// copy-utils hands it — the side effects are tests/services/task-bulk-create.
const createTasksInBulk = vi.hoisted(() => vi.fn())
vi.mock('@/services/task-bulk-create', () => ({ createTasksInBulk }))

import { copyTask, copyListWithTasks } from '@/lib/copy-utils'
import { mockPrisma } from '../setup'

function sourceTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'original-task-id',
    title: 'Test Task',
    description: 'Test Description',
    priority: 2,
    completed: false,
    repeating: 'never',
    repeatingData: null,
    repeatFrom: 'COMPLETION_DATE',
    occurrenceCount: 5,
    isPrivate: false,
    assigneeId: 'original-assignee-id',
    creatorId: 'original-creator-id',
    originalTaskId: null,
    dueDateTime: new Date('2025-12-25'),
    createdAt: new Date(),
    updatedAt: new Date(),
    comments: [],
    attachments: [],
    lists: [],
    ...overrides,
  }
}

function handedOver() {
  return createTasksInBulk.mock.calls[0][0] as {
    actorId: string
    tasks: Array<{ data: Record<string, unknown>; listIds: string[]; comments?: unknown[] }>
  }
}

describe('copyTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createTasksInBulk.mockImplementation(async ({ tasks }: { tasks: Array<{ data: object }> }) => ({
      tasks: tasks.map((t, i) => ({ id: `copy-${i}`, ...t.data })),
    }))
  })

  describe('assignee behavior', () => {
    it('should make task unassigned when copying to a list', async () => {
      mockPrisma.task.findUnique.mockResolvedValue(sourceTask())

      const result = await copyTask('original-task-id', {
        newOwnerId: 'new-owner-id',
        targetListId: 'target-list-id',
        preserveDueDate: false,
      })

      expect(result.success).toBe(true)
      expect(result.copiedTask?.assigneeId).toBeNull()
      const { actorId, tasks } = handedOver()
      expect(actorId).toBe('new-owner-id')
      expect(tasks[0].listIds).toEqual(['target-list-id'])
      expect(tasks[0].data).toMatchObject({
        assigneeId: null,
        originalTaskId: 'original-task-id',
        occurrenceCount: 0,
        completed: false,
        dueDateTime: null,
      })
    })

    it('should assign task to current user when copying without a list (My Tasks only)', async () => {
      mockPrisma.task.findUnique.mockResolvedValue(sourceTask())

      const result = await copyTask('original-task-id', { newOwnerId: 'new-owner-id' })

      expect(result.copiedTask?.assigneeId).toBe('new-owner-id')
      expect(handedOver().tasks[0].listIds).toEqual([])
    })

    it('should make task unassigned when copying to a list even if original task was unassigned', async () => {
      mockPrisma.task.findUnique.mockResolvedValue(sourceTask({ assigneeId: null }))

      await copyTask('original-task-id', { newOwnerId: 'new-owner-id', targetListId: 'target-list-id' })

      expect(handedOver().tasks[0].data.assigneeId).toBeNull()
    })

    it('should assign to current user when copying without a list even if original task was unassigned', async () => {
      mockPrisma.task.findUnique.mockResolvedValue(sourceTask({ assigneeId: null }))

      await copyTask('original-task-id', { newOwnerId: 'new-owner-id' })

      expect(handedOver().tasks[0].data.assigneeId).toBe('new-owner-id')
    })
  })

  it('preserves the due date only when asked', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(sourceTask())
    await copyTask('original-task-id', { newOwnerId: 'u', preserveDueDate: true })
    expect(handedOver().tasks[0].data.dueDateTime).toEqual(new Date('2025-12-25'))
  })

  it('carries authored comments with their authors, and drops system comments', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(sourceTask({
      comments: [
        { content: 'mine', authorId: 'author-1' },
        { content: 'X created this task', authorId: null },
      ],
    }))

    await copyTask('original-task-id', { newOwnerId: 'u', includeComments: true })

    expect(handedOver().tasks[0].comments).toEqual([{ content: 'mine', authorId: 'author-1' }])
  })

  it('reports a refused create as a failure', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(sourceTask())
    createTasksInBulk.mockResolvedValue({ tasks: [], rejected: [{ index: 0, status: 403, error: 'nope' }] })

    expect(await copyTask('original-task-id', { newOwnerId: 'u' })).toEqual({ success: false, error: 'nope' })
  })
})

describe('copyListWithTasks (AWTD-1124)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createTasksInBulk.mockImplementation(async ({ tasks }: { tasks: unknown[] }) => ({
      tasks: tasks.map((_, i) => ({ id: `copy-${i}` })),
    }))
  })

  it('copies every task in ONE bulk create, not one create per task', async () => {
    mockPrisma.taskList.findUnique
      .mockResolvedValueOnce({
        id: 'src', name: 'Src', privacy: 'PRIVATE', ownerId: 'u', owner: { id: 'u' }, listMembers: [],
        tasks: [sourceTask({ id: 't1' }), sourceTask({ id: 't2' }), sourceTask({ id: 't3' })],
      })
      .mockResolvedValueOnce({ id: 'new-list', tasks: [] })
    mockPrisma.taskList.create.mockResolvedValue({ id: 'new-list', tasks: [] })

    const result = await copyListWithTasks('src', { newOwnerId: 'u', includeTasks: true })

    expect(result).toMatchObject({ success: true, copiedTasksCount: 3 })
    expect(createTasksInBulk).toHaveBeenCalledTimes(1)
    const { tasks } = handedOver()
    expect(tasks.map(t => t.data.originalTaskId)).toEqual(['t1', 't2', 't3'])
    expect(tasks.every(t => t.listIds[0] === 'new-list' && t.data.assigneeId === null)).toBe(true)
    expect(mockPrisma.task.create).not.toHaveBeenCalled()
  })
})
