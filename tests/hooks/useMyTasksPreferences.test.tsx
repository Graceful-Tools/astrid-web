/**
 * Tests for useMyTasksPreferences hook
 * Ensures cross-device My Tasks filter sync works correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useMyTasksPreferences } from '@/hooks/useMyTasksPreferences'

// Mock fetch
global.fetch = vi.fn()

// Mock SSE subscription
vi.mock('@/hooks/use-sse-subscription', () => ({
  useSSESubscription: vi.fn((eventType, callback) => {
    // Store callback for later invocation in tests
    ;(global as any).__sseCallback = callback
  }),
}))

describe('useMyTasksPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(global as any).__sseCallback = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Initial Load', () => {
    it('should fetch preferences on mount', async () => {
      const mockPreferences = {
        filterPriority: [2, 3],
        filterAssignee: ['user-123'],
        filterDueDate: 'today',
        filterCompletion: 'incomplete',
        sortBy: 'when',
      }

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockPreferences,
      } as Response)

      const { result } = renderHook(() => useMyTasksPreferences())

      expect(result.current.isLoading).toBe(true)

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(fetch).toHaveBeenCalledWith('/api/v1/users/me/my-tasks-preferences')
      expect(result.current.filters).toEqual({
        priority: [2, 3],
        assignee: ['user-123'],
        dueDate: 'today',
        completion: 'incomplete',
        sortBy: 'when',
        manualSortOrder: [],
      })
    })

    it('should use default preferences when fetch fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response)

      const { result } = renderHook(() => useMyTasksPreferences())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.filters).toEqual({
        priority: [],
        assignee: [],
        dueDate: 'all',
        completion: 'default',
        sortBy: 'auto',
        manualSortOrder: [],
      })
    })
  })

  describe('SSE Updates', () => {
    it('should update preferences when SSE event is received', async () => {
      const initialPreferences = {
        filterPriority: [0, 1, 2, 3],
        filterAssignee: [],
        filterDueDate: 'all',
        filterCompletion: 'default',
        sortBy: 'auto',
      }

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => initialPreferences,
      } as Response)

      const { result } = renderHook(() => useMyTasksPreferences())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Simulate SSE event from another device
      const updatedPreferences = {
        filterPriority: [3],
        filterAssignee: ['user-456'],
        filterDueDate: 'today',
        filterCompletion: 'incomplete',
        sortBy: 'priority',
      }

      act(() => {
        const sseCallback = (global as any).__sseCallback
        if (sseCallback) {
          sseCallback({ data: updatedPreferences })
        }
      })

      expect(result.current.filters).toEqual({
        priority: [3],
        assignee: ['user-456'],
        dueDate: 'today',
        completion: 'incomplete',
        sortBy: 'priority',
        manualSortOrder: [],
      })
    })
  })

  describe('Optimistic Updates', () => {
    it('should optimistically update filter priority', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response)

      const { result } = renderHook(() => useMyTasksPreferences())

      await waitFor(() => expect(result.current.isLoading).toBe(false))

      act(() => {
        result.current.setters.setFilterPriority([1, 2])
      })

      // Should update immediately (optimistic)
      expect(result.current.filters.priority).toEqual([1, 2])
    })

    it('should optimistically update all filter types', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response)

      const { result } = renderHook(() => useMyTasksPreferences())

      await waitFor(() => expect(result.current.isLoading).toBe(false))

      // Update various filters
      act(() => {
        result.current.setters.setFilterAssignee(['user-123'])
        result.current.setters.setFilterDueDate('today')
        result.current.setters.setFilterCompletion('incomplete')
        result.current.setters.setSortBy('priority')
      })

      // All should update optimistically
      expect(result.current.filters.assignee).toEqual(['user-123'])
      expect(result.current.filters.dueDate).toBe('today')
      expect(result.current.filters.completion).toBe('incomplete')
      expect(result.current.filters.sortBy).toBe('priority')
    })

    it('should reset all filters to defaults', async () => {
      const customPreferences = {
        filterPriority: [2, 3],
        filterAssignee: ['user-123'],
        filterDueDate: 'today',
        filterCompletion: 'incomplete',
        sortBy: 'when',
      }

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => customPreferences,
      } as Response)

      const { result } = renderHook(() => useMyTasksPreferences())

      await waitFor(() => expect(result.current.isLoading).toBe(false))

      act(() => {
        result.current.clearAllFilters()
      })

      expect(result.current.filters).toEqual({
        priority: [],
        assignee: [],
        dueDate: 'all',
        completion: 'default',
        sortBy: 'auto',
        manualSortOrder: [],
      })
    })
  })

  describe('Has Active Filters', () => {
    it('should return false for default preferences', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          filterPriority: [],
          filterAssignee: [],
          filterDueDate: 'all',
          filterCompletion: 'default',
          sortBy: 'auto',
        }),
      } as Response)

      const { result } = renderHook(() => useMyTasksPreferences())

      await waitFor(() => expect(result.current.isLoading).toBe(false))

      expect(result.current.hasActiveFilters).toBe(false)
    })

    it('should return true when filters are active', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          filterPriority: [2, 3],
          filterAssignee: [],
          filterDueDate: 'all',
          filterCompletion: 'default',
          sortBy: 'auto',
        }),
      } as Response)

      const { result } = renderHook(() => useMyTasksPreferences())

      await waitFor(() => expect(result.current.isLoading).toBe(false))

      expect(result.current.hasActiveFilters).toBe(true)
    })
  })
})
