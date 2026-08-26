import { describe, it, expect } from 'vitest'
import { getFixedListTaskCount } from '@/lib/task-manager-utils'
import type { Task } from '@/types/task'

describe('getFixedListTaskCount', () => {
  const currentUserId = 'user-123'
  const otherUserId = 'user-456'

  const makeTask = (overrides: Partial<Task>): Task =>
    ({
      id: overrides.id ?? crypto.randomUUID(),
      title: overrides.title ?? 'Task',
      description: overrides.description ?? '',
      priority: overrides.priority ?? 0,
      completed: overrides.completed ?? false,
      assigneeId: overrides.assigneeId ?? null,
      creatorId: overrides.creatorId ?? currentUserId,
      dueDateTime: overrides.dueDateTime ?? null,
      isPrivate: overrides.isPrivate ?? false,
      when: overrides.when ?? null,
      createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: overrides.updatedAt ?? new Date('2026-01-01T00:00:00.000Z'),
      lists: overrides.lists ?? [],
    }) as Task

  it('counts My Tasks using the same assignee/creator rules as the list view', () => {
    const tasks = [
      makeTask({ id: 'assigned-open', assigneeId: currentUserId, completed: false }),
      makeTask({ id: 'assigned-completed', assigneeId: currentUserId, completed: true }),
      makeTask({ id: 'created-unassigned', assigneeId: null, creatorId: currentUserId, completed: false }),
      makeTask({ id: 'other-users-task', assigneeId: otherUserId, creatorId: otherUserId, completed: false }),
    ]

    expect(
      getFixedListTaskCount(tasks, 'my-tasks', currentUserId, { completionFilter: 'all' }),
    ).toBe(3)
  })

  it('applies the My Tasks completion filter to the badge count', () => {
    const tasks = [
      makeTask({ id: 'open-1', assigneeId: currentUserId, completed: false }),
      makeTask({ id: 'completed-1', assigneeId: currentUserId, completed: true }),
      makeTask({ id: 'created-unassigned-completed', assigneeId: null, creatorId: currentUserId, completed: true }),
    ]

    expect(
      getFixedListTaskCount(tasks, 'my-tasks', currentUserId, { completionFilter: 'completed' }),
    ).toBe(2)

    expect(
      getFixedListTaskCount(tasks, 'my-tasks', currentUserId, { completionFilter: 'incomplete' }),
    ).toBe(1)
  })
})
