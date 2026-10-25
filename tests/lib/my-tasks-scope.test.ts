/**
 * AWTD-1262 — My Tasks scope, out of the hook.
 *
 * Web's My Tasks rule lived inside `useFilterState.applyFiltersToTasks`, so no script could run
 * it and the contract fixtures could not lock it (astrid-core D25). These tests pin what the hook
 * answers today, then hold the pure module to the same answers, so the extraction cannot move a
 * task in or out of anyone's My Tasks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { buildTask, buildUser } from '../fixtures/domain'
import type { Task } from '@/types/task'
import { isInMyTasksScope, myTasksShows } from '@/lib/my-tasks-scope'
import { useFilterState } from '@/hooks/useFilterState'

const prefs = vi.hoisted(() => ({
  filterPriority: [] as number[],
  filterAssignee: [] as string[],
}))

vi.mock('@/hooks/useMyTasksPreferences', () => ({
  useMyTasksPreferences: () => ({
    filters: {
      completion: 'all',
      priority: prefs.filterPriority,
      assignee: prefs.filterAssignee,
      dueDate: 'all',
      sortBy: 'auto',
    },
    hasActiveFilters: false,
    setters: {},
    clearAllFilters: vi.fn(),
  }),
}))

const ME = 'u-me'
const other = buildUser({ id: 'u-other', name: 'Other' })
const me = buildUser({ id: ME, name: 'Me' })

const TASKS: Task[] = [
  buildTask({ id: 'assigned-to-me', assigneeId: ME, assignee: me, creatorId: 'u-other', priority: 3 }),
  buildTask({ id: 'created-unassigned', assigneeId: null, assignee: null, creatorId: ME, priority: 0 }),
  buildTask({ id: 'created-assigned-other', assigneeId: 'u-other', assignee: other, creatorId: ME, priority: 1 }),
  buildTask({ id: 'someone-elses', assigneeId: 'u-other', assignee: other, creatorId: 'u-other', priority: 2 }),
  buildTask({ id: 'unassigned-not-mine', assigneeId: null, assignee: null, creatorId: 'u-other', priority: 0 }),
  buildTask({ id: 'assigned-to-me-done', assigneeId: ME, assignee: me, creatorId: ME, completed: true, priority: 2 }),
]

function hookShows(userId: string | undefined): string[] {
  const { result } = renderHook(() => useFilterState({ selectedListId: 'my-tasks' }))
  return result.current.applyFiltersToTasks(TASKS, userId, []).map((t) => t.id).sort()
}

describe('My Tasks scope (AWTD-1262)', () => {
  beforeEach(() => {
    prefs.filterPriority = []
    prefs.filterAssignee = []
  })

  it('the hook keeps what is assigned to me, plus unassigned tasks I created', () => {
    expect(hookShows(ME)).toEqual(['assigned-to-me', 'assigned-to-me-done', 'created-unassigned'])
  })

  it('the hook narrows by the saved priority and assignee preferences', () => {
    prefs.filterPriority = [3, 0]
    expect(hookShows(ME)).toEqual(['assigned-to-me', 'created-unassigned'])
    prefs.filterPriority = []
    prefs.filterAssignee = ['unassigned']
    expect(hookShows(ME)).toEqual(['created-unassigned'])
  })

  it('isInMyTasksScope answers as the hook does, task by task', () => {
    const kept = TASKS.filter((t) => isInMyTasksScope(t, ME)).map((t) => t.id).sort()
    expect(kept).toEqual(hookShows(ME))
  })

  it('myTasksShows applies the priority and assignee preferences on top of the scope', () => {
    const shown = (filterPriority: number[], filterAssignee: string[]) =>
      TASKS.filter((t) => myTasksShows(t, ME, { filterPriority, filterAssignee })).map((t) => t.id).sort()
    expect(shown([3, 0], [])).toEqual(['assigned-to-me', 'created-unassigned'])
    expect(shown([], ['unassigned'])).toEqual(['created-unassigned'])
    expect(shown([], [ME])).toEqual(['assigned-to-me', 'assigned-to-me-done'])
  })

  it('reads only assigneeId, never the nested assignee (D25: iOS reads the relation too)', () => {
    const nestedOnly = { assigneeId: undefined, assignee: { id: ME }, creatorId: 'u-other' }
    expect(isInMyTasksScope(nestedOnly, ME)).toBe(false)
  })
})
