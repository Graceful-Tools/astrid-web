/**
 * ADEV-91 — a list's saved priority, assignee and due-date filters apply on web, as they do
 * on iOS and the Mac (core `rows`).
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFilterState } from '@/hooks/useFilterState'
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
