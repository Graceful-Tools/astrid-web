/**
 * Regression for task 61ecf56b — "On web the filter seems to reset back to All tasks."
 *
 * useFilterState reset the per-list completion/sort filters to the list's saved
 * defaults in effects keyed on the `currentList` *object reference*. currentList
 * is `lists.find(...)`, which returns a new reference on every task update / SSE
 * push / refetch — so each refetch re-fired the effect and clobbered the user's
 * in-session filter selection back to the list default.
 *
 * The fix keys those effects on the primitive values (currentList.id /
 * .filterCompletion / .sortBy), so a new object with identical values no longer
 * resets the user's choice, while switching lists (or changing the saved
 * default) still applies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFilterState } from '@/hooks/useFilterState'
import type { TaskList } from '@/types/task'

function makeList(overrides: Partial<TaskList> = {}): TaskList {
  return {
    id: 'list-1',
    name: 'List 1',
    privacy: 'PRIVATE',
    ownerId: 'user-1',
    filterCompletion: 'default',
    sortBy: 'auto',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  } as TaskList
}

describe('useFilterState — filter persists across currentList reference changes (task 61ecf56b)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the user completion filter when currentList gets a new reference (refetch/SSE)', () => {
    const { result, rerender } = renderHook(
      ({ list }) => useFilterState({ selectedListId: 'list-1', currentList: list }),
      { initialProps: { list: makeList() } },
    )

    act(() => {
      result.current.setCompleted('all')
    })
    expect(result.current.filters.completed).toBe('all')

    // A refetch/SSE produces a NEW object with identical id + saved default.
    act(() => {
      rerender({ list: makeList() })
    })

    // Must NOT snap back to the list default ("All tasks" reset bug).
    expect(result.current.filters.completed).toBe('all')
  })

  it('keeps the user sort choice when currentList gets a new reference', () => {
    const { result, rerender } = renderHook(
      ({ list }) => useFilterState({ selectedListId: 'list-1', currentList: list }),
      { initialProps: { list: makeList() } },
    )

    act(() => {
      result.current.setSortBy('priority')
    })
    expect(result.current.filters.sortBy).toBe('priority')

    act(() => {
      rerender({ list: makeList() })
    })

    expect(result.current.filters.sortBy).toBe('priority')
  })

  it('still loads the saved default when the list actually changes', () => {
    const { result, rerender } = renderHook(
      ({ id, list }) => useFilterState({ selectedListId: id, currentList: list }),
      { initialProps: { id: 'list-1', list: makeList() } },
    )

    act(() => {
      result.current.setCompleted('all')
    })
    expect(result.current.filters.completed).toBe('all')

    // Switching to a different list must apply that list's saved default.
    act(() => {
      rerender({ id: 'list-2', list: makeList({ id: 'list-2', filterCompletion: 'incomplete' }) })
    })

    expect(result.current.filters.completed).toBe('incomplete')
  })
})
