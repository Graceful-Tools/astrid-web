import { describe, it, expect } from 'vitest'
import { applyVirtualListFilter } from '@/lib/virtual-list-utils'
import { Task, TaskList } from '@/types/task'

/**
 * The list-level "Repeating" filter was DEAD on every platform: web, iOS and Mac all showed the
 * control and persisted `filterRepeating`, but no filtering code read it. These mirror
 * RepeatingFilterTests.swift so the two engines cannot drift.
 */
describe('filterRepeating', () => {
  const userId = 'user-1'

  const task = (id: string, repeating: string | null): Task => ({
    id,
    title: `Task ${id}`,
    description: '',
    priority: 0,
    completed: false,
    assigneeId: userId,
    creatorId: userId,
    dueDateTime: null,
    isPrivate: false,
    when: null,
    repeating,
    createdAt: new Date(),
    updatedAt: new Date(),
    lists: [],
  } as unknown as Task)

  const list = (filterRepeating: string | null): TaskList => ({
    id: 'list-1',
    name: 'List',
    isVirtual: true,
    virtualListType: undefined,
    ownerId: userId,
    filterCompletion: 'all',      // isolate the repeating dimension
    filterRepeating,
    lists: [],
    tasks: [],
    admins: [],
    members: [],
    listMembers: [],
  } as unknown as TaskList)

  const sample = [
    task('none', null), task('never', 'never'), task('daily', 'daily'),
    task('weekly', 'weekly'), task('monthly', 'monthly'), task('yearly', 'yearly'),
    task('custom', 'custom'),
  ]
  const ids = (tasks: Task[]) => tasks.map(t => t.id).sort()

  it('keeps every task for "all"', () => {
    expect(ids(applyVirtualListFilter(sample, list('all'), userId))).toEqual(ids(sample))
  })

  it('keeps every task when unset', () => {
    expect(ids(applyVirtualListFilter(sample, list(null), userId))).toEqual(ids(sample))
  })

  it('treats null AND "never" as not repeating', () => {
    expect(ids(applyVirtualListFilter(sample, list('not_repeating'), userId)))
      .toEqual(['never', 'none'])
  })

  it.each(['daily', 'weekly', 'monthly', 'yearly', 'custom'])(
    'keeps only %s tasks when filtering by that cadence', (cadence) => {
      expect(ids(applyVirtualListFilter(sample, list(cadence), userId))).toEqual([cadence])
    })

  it('keeps every task for an unknown value rather than blanking the list', () => {
    expect(ids(applyVirtualListFilter(sample, list('fortnightly'), userId))).toEqual(ids(sample))
  })
})
