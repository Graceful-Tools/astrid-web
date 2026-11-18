/**
 * ADEV-91 — a list's saved priority, assignee and due-date filters apply on web, as they do
 * on iOS and the Mac (core `rows`).
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFilterState, savedPriorityFilter, savedAssigneeFilter, savedDueDateFilter } from '@/hooks/useFilterState'
import { coreOrderedIds, savedViewFor, type LiveFilters } from '@/lib/core-rules/rows-core'
import type { TaskList } from '@/types/task'

const list = (o: Partial<TaskList> = {}) =>
  ({ id: 'l1', name: 'L', privacy: 'PRIVATE', ownerId: 'u1', filterCompletion: 'default', sortBy: 'auto', ...o }) as TaskList

describe('useFilterState saved filters (ADEV-91)', () => {
  it('loads the saved three', () => {
    const { result } = renderHook(() =>
      useFilterState({
        selectedListId: 'l1',
        currentUserId: 'me',
        currentList: list({ filterPriority: '3', filterAssignee: 'current_user', filterDueDate: 'today' }),
      }),
    )
    expect(result.current.filters.priority).toEqual([3])
    expect(result.current.filters.assignee).toEqual(['me'])
    expect(result.current.filters.dueDate).toBe('today')
  })

  it('reads "all" and retired windows', () => {
    const { result } = renderHook(() =>
      useFilterState({
        selectedListId: 'l1',
        currentList: list({ filterPriority: 'all', filterAssignee: 'all', filterDueDate: 'this_calendar_week' }),
      }),
    )
    expect(result.current.filters.priority).toEqual([])
    expect(result.current.filters.assignee).toEqual([])
    expect(result.current.filters.dueDate).toBe('this_week')
  })

  it('keeps an in-session choice across a new list reference, and clear returns to the saved value', () => {
    const { result, rerender } = renderHook(({ l }) => useFilterState({ selectedListId: 'l1', currentList: l }), {
      initialProps: { l: list({ filterPriority: '2' }) },
    })
    act(() => result.current.setPriority([1]))
    rerender({ l: list({ filterPriority: '2' }) })
    expect(result.current.filters.priority).toEqual([1])
    act(() => result.current.clearAllFilters())
    expect(result.current.filters.priority).toEqual([2])
  })
})

/**
 * ADEV-91 acceptance, second half: once web applies the saved three, a list showing them is
 * still a saved view, so core `rows` is asked, and asked with the saved three rather than
 * cleared ones.
 */
describe('core rows sends the saved three (ADEV-91)', () => {
  const live = (o: Partial<LiveFilters> = {}): LiveFilters => ({
    search: '', completed: 'default', priority: [], assignee: [], dueDate: 'all', sortBy: 'auto', ...o,
  })
  const ask = (l: TaskList, filters: LiveFilters, currentUserId?: string) =>
    savedViewFor({
      selectedListId: l.id,
      currentList: l,
      filters,
      savedCompletion: 'default',
      savedSortBy: 'auto',
      saved: {
        priority: savedPriorityFilter(l.filterPriority),
        assignee: savedAssigneeFilter(l.filterAssignee, currentUserId),
        dueDate: savedDueDateFilter(l.filterDueDate),
      },
    })

  it('a list showing its saved priority, assignee and due date is a saved view', () => {
    const l = list({ filterPriority: '3', filterAssignee: 'current_user', filterDueDate: 'today' })
    expect(ask(l, live({ priority: [3], assignee: ['me'], dueDate: 'today' }), 'me')).toMatchObject({
      kind: 'list',
      filters: { filterPriority: '3', filterAssignee: 'current_user', filterDueDate: 'today' },
    })
  })

  it('a live edit away from the saved three is not', () => {
    const l = list({ filterPriority: '3' })
    expect(ask(l, live({ priority: [2] }))).toBeNull()
    expect(ask(l, live())).toBeNull()
  })

  it('a saved filter web does not apply is sent cleared, as web shows it', () => {
    const l = list({ filterAssignee: 'not_current_user' })
    expect(ask(l, live(), 'me')).toMatchObject({
      kind: 'list',
      filters: { filterPriority: null, filterAssignee: null, filterDueDate: null },
    })
  })

  it('the rows request carries the saved three', () => {
    const l = list({ filterPriority: '3', filterDueDate: 'today' })
    const view = ask(l, live({ priority: [3], dueDate: 'today' }))!
    const runJson = vi.fn(() => JSON.stringify({ ok: true, value: { ids: [] } }))
    coreOrderedIds({ runJson, view, candidates: [], lists: [l], currentUserId: 'me', now: new Date() })
    const request = JSON.parse((runJson.mock.calls[0] as unknown as [string])[0])
    expect(request.list).toMatchObject({ filterPriority: '3', filterAssignee: null, filterDueDate: 'today' })
  })
})
