import { describe, expect, it } from 'vitest'
import { buildTask, buildUser } from '../fixtures/domain'
import { sortTasksForList } from '@/lib/task-sort'
import type { Task } from '@/types/task'

// `id` came through `overrides` twice, and the creator was cast rather than
// built. (AWTD-916)
const baseTask = (overrides: Partial<Task> & { id: string }): Task =>
  buildTask({
    title: overrides.id,
    creator: buildUser({ id: 'u', email: 'u@e', name: 'U' }),
    creatorId: 'u',
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

  // AWTD-1325: "when" read the dropped `Task.when` and the legacy `dueDate`,
  // which v1 tasks do not carry — so with real rows every comparison was 0 and
  // the sort did nothing. It follows iOS (`sortTasksByListSetting`) and the
  // core (D33): completed last, then due date, undated after, ties by priority.
  it('when (AWTD-1325): sorts by dueDateTime, the field real tasks carry', () => {
    const tasks = [
      baseTask({ id: 'b', dueDateTime: new Date('2026-02-10T09:00:00Z') }),
      baseTask({ id: 'a', dueDateTime: new Date('2026-02-01T09:00:00Z') }),
      baseTask({ id: 'none' }),
    ]
    expect(sortTasksForList(tasks, 'when').map(t => t.id)).toEqual(['a', 'b', 'none'])
  })

  it('when (AWTD-1325): completed last, undated after dated, ties by priority', () => {
    const due = new Date('2026-02-01T09:00:00Z')
    const tasks = [
      baseTask({ id: 'done-early', completed: true, dueDateTime: new Date('2026-01-01T09:00:00Z') }),
      baseTask({ id: 'undated-high', priority: 3 }),
      baseTask({ id: 'tie-low', priority: 1, dueDateTime: due }),
      baseTask({ id: 'tie-high', priority: 3, dueDateTime: due }),
      baseTask({ id: 'later', dueDateTime: new Date('2026-03-01T09:00:00Z') }),
    ]
    expect(sortTasksForList(tasks, 'when').map(t => t.id)).toEqual([
      'tie-high', 'tie-low', 'later', 'undated-high', 'done-early',
    ])
  })

  it('when (AWTD-1325): ignores the legacy dueDate field', () => {
    const tasks = [
      baseTask({ id: 'legacy-only', dueDate: new Date('2026-01-01') }),
      baseTask({ id: 'dated', dueDateTime: new Date('2026-02-01T09:00:00Z') }),
    ]
    expect(sortTasksForList(tasks, 'when').map(t => t.id)).toEqual(['dated', 'legacy-only'])
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

describe('completedAt sort — most recently completed first', () => {
  it('orders completed tasks newest-completion-first, incomplete after', () => {
    const tasks = [
      baseTask({ id: 'open', completed: false }),
      baseTask({ id: 'old-done', completed: true, completedAt: new Date('2026-08-01T10:00:00Z') }),
      baseTask({ id: 'new-done', completed: true, completedAt: new Date('2026-08-27T10:00:00Z') }),
    ]

    expect(sortTasksForList(tasks, 'completedAt').map(t => t.id)).toEqual([
      'new-done',
      'old-done',
      'open',
    ])
  })

  it('falls back to updatedAt for a completed task with no completedAt', () => {
    // Same convention as the recently-completed window: completedAt is the
    // real stamp when sync backdated it, updatedAt is the legacy fallback.
    const tasks = [
      baseTask({ id: 'stamped', completed: true, completedAt: new Date('2026-08-10T00:00:00Z') }),
      baseTask({ id: 'legacy', completed: true, updatedAt: new Date('2026-08-20T00:00:00Z') }),
    ]

    expect(sortTasksForList(tasks, 'completedAt').map(t => t.id)).toEqual(['legacy', 'stamped'])
  })

  it('keeps incomplete tasks in auto order among themselves', () => {
    // The open half of the list should not scramble: it keeps the default
    // ordering (priority, then due date) so the view stays useful.
    const tasks = [
      baseTask({ id: 'low', completed: false, priority: 1 }),
      baseTask({ id: 'high', completed: false, priority: 3 }),
      baseTask({ id: 'done', completed: true, completedAt: new Date('2026-08-27T10:00:00Z') }),
    ]

    expect(sortTasksForList(tasks, 'completedAt').map(t => t.id)).toEqual(['done', 'high', 'low'])
  })
})
