import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiCall, apiGet, onCacheInvalidation } from '@/lib/api'

describe('Cache Invalidation System', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('API Error Cache Invalidation', () => {
    it('should trigger cache invalidation on API errors', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      })
      global.fetch = mockFetch

      const invalidationCallback = vi.fn()
      const unsubscribe = onCacheInvalidation(invalidationCallback)

      try {
        await apiGet('/api/tasks')
      } catch (error) {
        // Expected to throw
      }

      expect(invalidationCallback).toHaveBeenCalledTimes(1)
      unsubscribe()
    })

    it('should trigger cache invalidation on network errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
      global.fetch = mockFetch

      const invalidationCallback = vi.fn()
      const unsubscribe = onCacheInvalidation(invalidationCallback)

      try {
        await apiGet('/api/tasks')
      } catch (error) {
        // Expected to throw
      }

      expect(invalidationCallback).toHaveBeenCalledTimes(1)
      unsubscribe()
    })

    it('should not trigger cache invalidation on successful requests', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ tasks: [] })
      })
      global.fetch = mockFetch

      const invalidationCallback = vi.fn()
      const unsubscribe = onCacheInvalidation(invalidationCallback)

      await apiGet('/api/tasks')

      expect(invalidationCallback).not.toHaveBeenCalled()
      unsubscribe()
    })

    it('should notify multiple listeners on cache invalidation', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      })
      global.fetch = mockFetch

      const callback1 = vi.fn()
      const callback2 = vi.fn()
      const callback3 = vi.fn()

      const unsubscribe1 = onCacheInvalidation(callback1)
      const unsubscribe2 = onCacheInvalidation(callback2)
      const unsubscribe3 = onCacheInvalidation(callback3)

      try {
        await apiGet('/api/tasks')
      } catch (error) {
        // Expected to throw
      }

      expect(callback1).toHaveBeenCalledTimes(1)
      expect(callback2).toHaveBeenCalledTimes(1)
      expect(callback3).toHaveBeenCalledTimes(1)

      unsubscribe1()
      unsubscribe2()
      unsubscribe3()
    })

    it('should properly unsubscribe listeners', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      })
      global.fetch = mockFetch

      const callback = vi.fn()
      const unsubscribe = onCacheInvalidation(callback)

      // Unsubscribe immediately
      unsubscribe()

      try {
        await apiGet('/api/tasks')
      } catch (error) {
        // Expected to throw
      }

      // Callback should not be called after unsubscribe
      expect(callback).not.toHaveBeenCalled()
    })

    it('should handle errors in cache invalidation listeners', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      })
      global.fetch = mockFetch

      const faultyCallback = vi.fn().mockImplementation(() => {
        throw new Error('Listener error')
      })
      const goodCallback = vi.fn()

      const unsubscribe1 = onCacheInvalidation(faultyCallback)
      const unsubscribe2 = onCacheInvalidation(goodCallback)
      try {
        await apiGet('/api/tasks')
      } catch (error) {
        // Expected to throw
      }

      // Both callbacks should be called
      expect(faultyCallback).toHaveBeenCalledTimes(1)
      expect(goodCallback).toHaveBeenCalledTimes(1)

      // Error should be logged but not propagate
      unsubscribe2()
    })
  })

  describe('Cache Invalidation Integration', () => {
    it('should invalidate cache for specific endpoints', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      })
      global.fetch = mockFetch

      const invalidationCallback = vi.fn()
      const unsubscribe = onCacheInvalidation(invalidationCallback)

      try {
        await apiGet('/api/tasks/specific-task-id')
      } catch (error) {
        // Expected to throw
      }

      expect(invalidationCallback).toHaveBeenCalledTimes(1)
      unsubscribe()
    })

    it('should handle 401 unauthorized errors', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      })
      global.fetch = mockFetch

      const invalidationCallback = vi.fn()
      const unsubscribe = onCacheInvalidation(invalidationCallback)

      try {
        await apiGet('/api/tasks')
      } catch (error) {
        // Expected to throw
      }

      expect(invalidationCallback).toHaveBeenCalledTimes(1)
      unsubscribe()
    })

    it('should handle timeout errors', async () => {
      const mockFetch = vi.fn().mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Request timeout')), 0)
        })
      })
      global.fetch = mockFetch

      const invalidationCallback = vi.fn()
      const unsubscribe = onCacheInvalidation(invalidationCallback)

      try {
        await apiGet('/api/tasks')
      } catch (error) {
        // Expected to throw
      }

      expect(invalidationCallback).toHaveBeenCalledTimes(1)
      unsubscribe()
    })
  })
})
