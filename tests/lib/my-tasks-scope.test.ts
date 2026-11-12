/**
 * AWTD-1262 — My Tasks scope, out of the hook.
 *
 * Web's My Tasks rule lived inside `useFilterState.applyFiltersToTasks`, so no script could run
 * it and the contract fixtures could not lock it (astrid-core D25). These tests pin what the hook
 * answers, then hold the pure module to the same answers. Since AWTD-1583 both answer as iOS and
 * the core do: only what is assigned to you, the assignee filter not applied.
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

  it('AWTD-1583 (D25): the hook keeps only what is assigned to me — not unassigned tasks I created', () => {
    expect(hookShows(ME)).toEqual(['assigned-to-me', 'assigned-to-me-done'])
  })

  it('AWTD-1583 (D25): the hook narrows by the saved priority, and ignores the saved assignee filter', () => {
    prefs.filterPriority = [3, 0]
    expect(hookShows(ME)).toEqual(['assigned-to-me'])
    prefs.filterPriority = []
    prefs.filterAssignee = ['unassigned']
    expect(hookShows(ME)).toEqual(['assigned-to-me', 'assigned-to-me-done'])
  })

  it('AWTD-1583 (D25): signed out, My Tasks is empty', () => {
    expect(hookShows(undefined)).toEqual([])
    expect(TASKS.some((t) => isInMyTasksScope(t, null))).toBe(false)
  })

  it('isInMyTasksScope answers as the hook does, task by task', () => {
    const kept = TASKS.filter((t) => isInMyTasksScope(t, ME)).map((t) => t.id).sort()
    expect(kept).toEqual(hookShows(ME))
  })

  it('myTasksShows applies the priority preference on top of the scope, and not filterAssignee', () => {
    const shown = (filterPriority: number[], filterAssignee: string[]) =>
      TASKS.filter((t) => myTasksShows(t, ME, { filterPriority, filterAssignee })).map((t) => t.id).sort()
    expect(shown([3, 0], [])).toEqual(['assigned-to-me'])
    expect(shown([], ['unassigned'])).toEqual(['assigned-to-me', 'assigned-to-me-done'])
    expect(shown([], [ME])).toEqual(['assigned-to-me', 'assigned-to-me-done'])
  })

  it('AWTD-1583 (D25): reads the nested assignee when assigneeId is missing, as iOS does', () => {
    const nestedOnly = { assigneeId: undefined, assignee: { id: ME }, creatorId: 'u-other' }
    expect(isInMyTasksScope(nestedOnly, ME)).toBe(true)
  })
})
