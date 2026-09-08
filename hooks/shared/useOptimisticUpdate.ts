import { useState, useCallback } from 'react'

/**
 * Options for optimistic update behavior
 */
export interface OptimisticUpdateOptions<T> {
  /**
   * Function that performs the actual API update
   * Receives the optimistic data and should return the server response
   */
  updateFn: (optimisticData: T) => Promise<T>

  /**
   * Called when the update succeeds
   * Receives the final server data
   */
  onSuccess?: (data: T) => void

  /**
   * Called when the update fails
   * Receives the error and the previous data (before optimistic update)
   */
  onError?: (error: Error, previousData: T) => void
}

/**
 * Hook for implementing optimistic updates with automatic rollback on error
 *
 * @example
 * ```typescript
 * const [task, setTask] = useState(initialTask)
 * const { update, isUpdating } = useOptimisticUpdate(task, setTask, {
 *   // apiPut, not fetch: offline this queues the edit and replays it on
 *   // reconnect. A raw fetch here throws and the edit is gone, which is
 *   // exactly the bug an optimistic update makes invisible — the UI already
 *   // showed the new value before the write failed.
 *   updateFn: async (updatedTask) => {
 *     const response = await apiPut(`/api/v1/tasks/${updatedTask.id}`, updatedTask)
 *     // v1 answers { task, meta }; reading .id off the envelope yields
 *     // undefined with no error, so unwrap it.
 *     return unwrapTask<Task>(await response.json())
 *   },
 *   onSuccess: (task) => toast.success('Task updated'),
 *   onError: (error) => toast.error(error.message)
 * })
 *
 * // Use it
 * await update({ ...task, title: 'New Title' })
 * ```
 */
export function useOptimisticUpdate<T>(
  data: T,
  setData: (data: T) => void,
  options: OptimisticUpdateOptions<T>
) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const update = useCallback(
    async (optimisticData: T): Promise<T> => {
      const previousData = data

      // Clear any previous errors
      setError(null)

      // Apply optimistic update immediately
      setData(optimisticData)
      setIsUpdating(true)

      try {
        // Call API with optimistic data
        const serverData = await options.updateFn(optimisticData)

        // Sync with server response (may differ from optimistic data)
        setData(serverData)

        // Call success handler
        options.onSuccess?.(serverData)

        return serverData
      } catch (err) {
        // Rollback to previous data on error
        setData(previousData)

        const error = err instanceof Error ? err : new Error(String(err))
        setError(error)

        // Call error handler
        options.onError?.(error, previousData)

        throw error
      } finally {
        setIsUpdating(false)
      }
    },
    [data, setData, options]
  )

  return {
    update,
    isUpdating,
    error
  }
}
