import { describe, it, expect, vi, beforeEach , type Mock } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useOptimisticUpdate } from '@/hooks/shared/useOptimisticUpdate'

interface TestData {
  id: string
  value: string
}

describe('useOptimisticUpdate', () => {
  let mockData: TestData
  let mockSetData: Mock
  let mockUpdateFn: Mock
  let mockOnSuccess: Mock
  let mockOnError: Mock

  beforeEach(() => {
    mockData = { id: '1', value: 'original' }
    mockSetData = vi.fn()
    mockUpdateFn = vi.fn()
    mockOnSuccess = vi.fn()
    mockOnError = vi.fn()
  })

  it('should apply optimistic update immediately', async () => {
    const optimisticData = { id: '1', value: 'optimistic' }
    const serverData = { id: '1', value: 'server' }

    // Use a longer delay to reliably test the isUpdating state
    let resolveUpdate: (value: TestData) => void
    mockUpdateFn.mockImplementation(
      () => new Promise(resolve => { resolveUpdate = resolve })
    )

    const { result } = renderHook(() =>
      useOptimisticUpdate(mockData, mockSetData, {
        updateFn: mockUpdateFn,
        onSuccess: mockOnSuccess,
        onError: mockOnError
      })
    )

    // Call update without awaiting
    act(() => {
      result.current.update(optimisticData)
    })

    // Should immediately apply optimistic update (before API call completes)
    expect(mockSetData).toHaveBeenCalledWith(optimisticData)

    // Should set isUpdating to true while API call is in progress
    expect(result.current.isUpdating).toBe(true)

    // Resolve the update and wait for completion
    await act(async () => {
      resolveUpdate!(serverData)
    })

    // Wait for update to complete
    await waitFor(() => {
      expect(result.current.isUpdating).toBe(false)
    })
  })

  it('should sync with server response on success', async () => {
    const optimisticData = { id: '1', value: 'optimistic' }
    const serverData = { id: '1', value: 'server' }

    mockUpdateFn.mockResolvedValue(serverData)

    const { result } = renderHook(() =>
      useOptimisticUpdate(mockData, mockSetData, {
        updateFn: mockUpdateFn,
        onSuccess: mockOnSuccess,
        onError: mockOnError
      })
    )

    await act(async () => {
      await result.current.update(optimisticData)
    })

    // Should call API with optimistic data
    expect(mockUpdateFn).toHaveBeenCalledWith(optimisticData)

    // Should sync with server response
    await waitFor(() => {
      expect(mockSetData).toHaveBeenCalledWith(serverData)
    })

    // Should call success handler with server data
    expect(mockOnSuccess).toHaveBeenCalledWith(serverData)

    // Should not call error handler
    expect(mockOnError).not.toHaveBeenCalled()

    // Should set isUpdating to false
    expect(result.current.isUpdating).toBe(false)

    // Should clear error
    expect(result.current.error).toBeNull()
  })

  it('should rollback to previous data on error', async () => {
    const optimisticData = { id: '1', value: 'optimistic' }
    const error = new Error('API error')

    mockUpdateFn.mockRejectedValue(error)

    const { result } = renderHook(() =>
      useOptimisticUpdate(mockData, mockSetData, {
        updateFn: mockUpdateFn,
        onSuccess: mockOnSuccess,
        onError: mockOnError
      })
    )

    await act(async () => {
      try {
        await result.current.update(optimisticData)
      } catch (err) {
        // Expected to throw
      }
    })

    // Should rollback to previous data
    await waitFor(() => {
      expect(mockSetData).toHaveBeenCalledWith(mockData)
    })

    // Should call error handler with error and previous data
    expect(mockOnError).toHaveBeenCalledWith(error, mockData)

    // Should not call success handler
    expect(mockOnSuccess).not.toHaveBeenCalled()

    // Should set isUpdating to false
    expect(result.current.isUpdating).toBe(false)

    // Should set error state
    expect(result.current.error).toBe(error)
  })

  it('should handle non-Error exceptions', async () => {
    const optimisticData = { id: '1', value: 'optimistic' }
    const errorMessage = 'String error'

    mockUpdateFn.mockRejectedValue(errorMessage)

    const { result } = renderHook(() =>
      useOptimisticUpdate(mockData, mockSetData, {
        updateFn: mockUpdateFn,
        onSuccess: mockOnSuccess,
        onError: mockOnError
      })
    )

    await act(async () => {
      try {
        await result.current.update(optimisticData)
      } catch (err) {
        // Expected to throw
      }
    })

    // Should convert string to Error
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe(errorMessage)

    // Should rollback
    expect(mockSetData).toHaveBeenCalledWith(mockData)
  })

  it('should handle concurrent updates correctly', async () => {
    const optimisticData1 = { id: '1', value: 'update1' }
    const optimisticData2 = { id: '1', value: 'update2' }
    const serverData1 = { id: '1', value: 'server1' }
    const serverData2 = { id: '1', value: 'server2' }

    // First update succeeds quickly
    const updateFn1 = vi.fn().mockResolvedValue(serverData1)
    // Second update takes longer but also succeeds
    const updateFn2 = vi.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve(serverData2), 100))
    )

    const { result, rerender } = renderHook(
      ({ data, updateFn }) => useOptimisticUpdate(data, mockSetData, { updateFn }),
      {
        initialProps: { data: mockData, updateFn: updateFn1 }
      }
    )

    // Start first update
    act(() => {
      result.current.update(optimisticData1)
    })

    // Update the hook's updateFn for second call
    rerender({ data: optimisticData1, updateFn: updateFn2 })

    // Start second update immediately
    await act(async () => {
      await result.current.update(optimisticData2)
    })

    // Both updates should have been called
    expect(updateFn1).toHaveBeenCalled()
    expect(updateFn2).toHaveBeenCalled()

    // Final state should be from second update
    await waitFor(() => {
      expect(mockSetData).toHaveBeenCalledWith(serverData2)
    })
  })

  it('should return the server data from update function', async () => {
    const optimisticData = { id: '1', value: 'optimistic' }
    const serverData = { id: '1', value: 'server' }

    mockUpdateFn.mockResolvedValue(serverData)

    const { result } = renderHook(() =>
      useOptimisticUpdate(mockData, mockSetData, {
        updateFn: mockUpdateFn
      })
    )

    let returnedData: TestData | undefined

    await act(async () => {
      returnedData = await result.current.update(optimisticData)
    })

    expect(returnedData).toEqual(serverData)
  })

  it('should throw error from update function on failure', async () => {
    const optimisticData = { id: '1', value: 'optimistic' }
    const error = new Error('API error')

    mockUpdateFn.mockRejectedValue(error)

    const { result } = renderHook(() =>
      useOptimisticUpdate(mockData, mockSetData, {
        updateFn: mockUpdateFn
      })
    )

    await act(async () => {
      await expect(result.current.update(optimisticData)).rejects.toThrow('API error')
    })
  })

  it('should clear previous errors on new update', async () => {
    const optimisticData1 = { id: '1', value: 'update1' }
    const optimisticData2 = { id: '1', value: 'update2' }
    const error = new Error('First error')
    const serverData = { id: '1', value: 'server' }

    mockUpdateFn
      .mockRejectedValueOnce(error) // First call fails
      .mockResolvedValueOnce(serverData) // Second call succeeds

    const { result } = renderHook(() =>
      useOptimisticUpdate(mockData, mockSetData, {
        updateFn: mockUpdateFn,
        onError: mockOnError
      })
    )

    // First update fails
    await act(async () => {
      try {
        await result.current.update(optimisticData1)
      } catch (err) {
        // Expected
      }
    })

    expect(result.current.error).toBe(error)

    // Second update succeeds
    await act(async () => {
      await result.current.update(optimisticData2)
    })

    // Error should be cleared
    expect(result.current.error).toBeNull()
  })

  it('should work without optional callbacks', async () => {
    const optimisticData = { id: '1', value: 'optimistic' }
    const serverData = { id: '1', value: 'server' }

    mockUpdateFn.mockResolvedValue(serverData)

    const { result } = renderHook(() =>
      useOptimisticUpdate(mockData, mockSetData, {
        updateFn: mockUpdateFn
        // No onSuccess or onError
      })
    )

    // Should not throw even without callbacks
    await act(async () => {
      await result.current.update(optimisticData)
    })

    expect(mockSetData).toHaveBeenCalledWith(serverData)
  })
})
