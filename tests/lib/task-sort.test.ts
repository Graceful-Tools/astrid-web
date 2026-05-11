import { describe, expect, it } from 'vitest'
import { sortTasksForList } from '@/lib/task-sort'
import type { Task } from '@/types/task'

const baseTask = (overrides: Partial<Task> & { id: string }): Task => ({
  id: overrides.id,
  title: overrides.title ?? overrides.id,
  description: '',
  creator: { id: 'u', email: 'u@e', name: 'U', createdAt: new Date('2026-01-01') } as Task['creator'],
  creatorId: 'u',
  priority: 0,
  lists: [],
  isPrivate: false,
  completed: false,
  attachments: [],
  comments: [],
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  repeating: 'never',
  repeatFrom: 'COMPLETION_DATE',
  occurrenceCount: 0,
  ...overrides,
})

describe('sortTasksForList', () => {
  it('priority: highest first', () => {
    const tasks = [
      baseTask({ id: 'low', priority: 1 }),
      baseTask({ id: 'high', priority: 3 }),
      baseTask({ id: 'mid', priority: 2 }),
    ]
    expect(sortTasksForList(tasks, 'priority').map(t => t.id)).toEqual(['high', 'mid', 'low'])
  })

  it('when: earliest due date first, no-date last', () => {
    const tasks = [
      baseTask({ id: 'b', dueDate: new Date('2026-02-10') }),
      baseTask({ id: 'a', dueDate: new Date('2026-02-01') }),
      baseTask({ id: 'none' }),
    ]
    expect(sortTasksForList(tasks, 'when').map(t => t.id)).toEqual(['a', 'b', 'none'])
  })

  it('auto: incomplete before completed, then priority desc, then due date asc', () => {
    const tasks = [
      baseTask({ id: 'done-high', completed: true, priority: 3 }),
      baseTask({ id: 'open-low', priority: 1 }),
      baseTask({ id: 'open-high', priority: 3, dueDateTime: new Date('2026-02-05') }),
      baseTask({ id: 'open-high-earlier', priority: 3, dueDateTime: new Date('2026-02-01') }),
    ]
    expect(sortTasksForList(tasks, 'auto').map(t => t.id)).toEqual([
      'open-high-earlier',
      'open-high',
      'open-low',
      'done-high',
    ])
  })

  it('manual: honors the provided order and appends unknown ids by creation date', () => {
    const tasks = [
      baseTask({ id: 'a', createdAt: new Date('2026-01-01T00:00:00Z') }),
      baseTask({ id: 'b', createdAt: new Date('2026-01-02T00:00:00Z') }),
      baseTask({ id: 'c', createdAt: new Date('2026-01-03T00:00:00Z') }),
      baseTask({ id: 'd-new', createdAt: new Date('2026-01-04T00:00:00Z') }),
    ]
    expect(sortTasksForList(tasks, 'manual', ['c', 'a', 'b']).map(t => t.id)).toEqual([
      'c',
      'a',
      'b',
      'd-new',
    ])
  })

  it('manual: falls back to creation order when no manual order is supplied', () => {
    const tasks = [
      baseTask({ id: 'late', createdAt: new Date('2026-01-05') }),
      baseTask({ id: 'early', createdAt: new Date('2026-01-01') }),
    ]
    expect(sortTasksForList(tasks, 'manual', undefined).map(t => t.id)).toEqual(['early', 'late'])
  })
})
