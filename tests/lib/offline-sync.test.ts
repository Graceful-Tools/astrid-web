import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock fetch FIRST before any imports
global.fetch = vi.fn()

// Mock apiCall from lib/api to use our fetch mock - MUST be before importing offline-sync
vi.mock('@/lib/api', () => ({
  apiCall: async (endpoint: string, options: any = {}) => {
    // Call the global.fetch mock directly
    return await (global.fetch as any)(endpoint, options)
  }
}))

// NOW import the modules that use the mocked dependencies
import { OfflineSyncManager, isOfflineMode, waitForOnline } from '@/lib/offline-sync'
import { offlineDB, type MutationOperation } from '@/lib/offline-db'

// Mock navigator.onLine
const mockNavigator = (online: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', {
    writable: true,
    value: online
  })
}

// Run tests sequentially to avoid race conditions with shared OfflineSyncManager state
describe.sequential('OfflineSyncManager', () => {
  beforeEach(async () => {
    // Wait first to ensure previous test's async operations are complete
    await new Promise(resolve => setTimeout(resolve, 20))

    // Clear database before each test
    await offlineDB.clearAll()
    vi.clearAllMocks()

    // Reset fetch mock with a default successful response
    ;(global.fetch as any).mockReset()
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
      text: async () => JSON.stringify({ success: true }),
      headers: new Headers(),
    })

    // Set online by default
    mockNavigator(true)
  })

  afterEach(async () => {
    await offlineDB.clearAll()
    vi.clearAllMocks()

    // Wait to ensure cleanup is complete
    await new Promise(resolve => setTimeout(resolve, 10))
  })

  describe('queueMutation', () => {
    it('should queue a mutation operation', async () => {
      mockNavigator(false)

      const mutation = await OfflineSyncManager.queueMutation(
        'create',
        'task',
        'task-123',
        '/api/tasks',
        'POST',
        { title: 'Test Task' }
      )

      expect(mutation.id).toBeDefined()
      expect(mutation.type).toBe('create')
      expect(mutation.entity).toBe('task')
      expect(mutation.entityId).toBe('task-123')
      expect(mutation.status).toBe('pending')
      expect(mutation.retryCount).toBe(0)

      // Verify it's in the database
      const stored = await offlineDB.mutations.get(mutation.id)
      expect(stored).toBeDefined()
      expect(stored?.entityId).toBe('task-123')
    })

    it('should attempt sync immediately if online', async () => {
      const syncSpy = vi.spyOn(OfflineSyncManager, 'syncPendingMutations')
        .mockResolvedValue({ success: 0, failed: 0, errors: [] })

      await OfflineSyncManager.queueMutation(
        'create',
        'task',
        'task-123',
        '/api/tasks',
        'POST',
        { title: 'Test Task' }
      )

      expect(syncSpy).toHaveBeenCalledOnce()
      syncSpy.mockRestore()
    })

    it('should not sync if offline', async () => {
      mockNavigator(false)

      await OfflineSyncManager.queueMutation(
        'create',
        'task',
        'task-123',
        '/api/tasks',
        'POST',
        { title: 'Test Task' }
      )

      // Should not attempt to sync when offline
      expect(global.fetch).not.toHaveBeenCalled()
    })
  })

  describe('getPendingMutations', () => {
    it('should return pending mutations sorted by timestamp', async () => {
      // Go offline so mutations don't auto-sync
      mockNavigator(false)

      // Create mutations with different timestamps
      await OfflineSyncManager.queueMutation(
        'create',
        'task',
        'task-1',
        '/api/tasks',
        'POST',
        { title: 'Task 1' }
      )

      await new Promise(resolve => setTimeout(resolve, 10))

      await OfflineSyncManager.queueMutation(
        'update',
        'task',
        'task-2',
        '/api/tasks/task-2',
        'PATCH',
        { title: 'Task 2 Updated' }
      )

      const pending = await OfflineSyncManager.getPendingMutations()

      expect(pending).toHaveLength(2)
      expect(pending[0].entityId).toBe('task-1')
      expect(pending[1].entityId).toBe('task-2')
      expect(pending[0].timestamp).toBeLessThan(pending[1].timestamp)
    })

    it('should not return completed or failed mutations', async () => {
      // Go offline to prevent auto-sync
      mockNavigator(false)

      const mutation = await OfflineSyncManager.queueMutation(
        'create',
        'task',
        'task-1',
        '/api/tasks',
        'POST',
        { title: 'Task 1' }
      )

      // Mark as completed
      await offlineDB.mutations.update(mutation.id, { status: 'completed' })

      const pending = await OfflineSyncManager.getPendingMutations()
      expect(pending).toHaveLength(0)
    })
  })

  describe('getMutationStats', () => {
    it('should return correct counts for each status', async () => {
      // Go offline to queue mutations without auto-sync
      mockNavigator(false)

      // Create pending mutations
      await OfflineSyncManager.queueMutation(
        'create',
        'task',
        'task-1',
        '/api/tasks',
        'POST'
      )

      await OfflineSyncManager.queueMutation(
        'create',
        'task',
        'task-2',
        '/api/tasks',
        'POST'
      )

      // Create failed mutation
      const failedMutation = await OfflineSyncManager.queueMutation(
        'create',
        'task',
        'task-3',
        '/api/tasks',
        'POST'
      )
      await offlineDB.mutations.update(failedMutation.id, { status: 'failed' })

      const stats = await OfflineSyncManager.getMutationStats()

      expect(stats.pending).toBe(2)
      expect(stats.failed).toBe(1)
      expect(stats.completed).toBe(0)
    })
  })

  describe('syncPendingMutations', () => {
    it('should sync pending mutations successfully', async () => {
      // Start offline to queue mutation without auto-sync
      mockNavigator(false)

      // Queue a mutation
      await OfflineSyncManager.queueMutation(
        'create',
        'task',
        'task-1',
        '/api/tasks',
        'POST',
        { title: 'Test Task' }
      )

      // Go online and mock successful response
      mockNavigator(true)
      ;(global.fetch as any).mockResolvedValueOnce(
        new Response(JSON.stringify({ task: { id: 'task-1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )

      const result = await OfflineSyncManager.syncPendingMutations()

      expect(result.success).toBe(1)
      expect(result.failed).toBe(0)
      expect(result.errors).toHaveLength(0)

      // Mutation should be removed from queue
      const pending = await OfflineSyncManager.getPendingMutations()
      expect(pending).toHaveLength(0)
    })

    it('should handle sync failures and retry', async () => {
      // Start offline to queue mutation
      mockNavigator(false)

      // Queue a mutation
      await OfflineSyncManager.queueMutation(
        'create',
        'task',
        'task-1',
        '/api/tasks',
        'POST',
        { title: 'Test Task' }
      )

      // Go online and mock failed response
      mockNavigator(true)
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      })

      const result = await OfflineSyncManager.syncPendingMutations()

      expect(result.success).toBe(0)
      expect(result.failed).toBe(1)
      expect(result.errors).toHaveLength(1)

      // Mutation should still be pending
      const pending = await OfflineSyncManager.getPendingMutations()
      expect(pending).toHaveLength(1)
      expect(pending[0].retryCount).toBe(1)
    })

    it('should mark mutation as failed after max retries', async () => {
      // Start offline to queue mutation
      mockNavigator(false)

      // Create a mutation with max retries already reached
      const mutation = await OfflineSyncManager.queueMutation(
        'create',
        'task',
        'task-1',
        '/api/tasks',
        'POST',
        { title: 'Test Task' }
      )

      // Set retry count to max - 1
      await offlineDB.mutations.update(mutation.id, { retryCount: 2 })

      // Go online and mock failed response
      mockNavigator(true)
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      })

      await OfflineSyncManager.syncPendingMutations()

      // Check mutation status
      const updated = await offlineDB.mutations.get(mutation.id)
      expect(updated?.status).toBe('failed')
      expect(updated?.retryCount).toBe(3)
    })

    it('should not sync when offline', async () => {
      mockNavigator(false)

      await OfflineSyncManager.queueMutation(
        'create',
        'task',
        'task-1',
        '/api/tasks',
        'POST'
      )

      const result = await OfflineSyncManager.syncPendingMutations()

      expect(result.success).toBe(0)
      expect(result.failed).toBe(0)
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('should prevent concurrent sync operations', async () => {
      // Start offline to queue mutation
      mockNavigator(false)

      await OfflineSyncManager.queueMutation(
        'create',
        'task',
        'task-1',
        '/api/tasks',
        'POST'
      )

      // Go online and mock slow response
      mockNavigator(true)
      ;(global.fetch as any).mockImplementation(() =>
        new Promise(resolve =>
          setTimeout(() => resolve(
            new Response(JSON.stringify({}), {
              status: 200,
              headers: { 'content-type': 'application/json' }
            })
          ), 100)
        )
      )

      // Start two syncs simultaneously
      const sync1 = OfflineSyncManager.syncPendingMutations()
      const sync2 = OfflineSyncManager.syncPendingMutations()

      const [result1, result2] = await Promise.all([sync1, sync2])

      // One should have synced, the other should have skipped
      const totalSuccess = result1.success + result2.success
      expect(totalSuccess).toBe(1)
    })
  })

  describe('retryFailedMutations', () => {
    it('should reset failed mutations to pending and retry', async () => {
      // Start offline to queue mutation
      mockNavigator(false)

      const mutation = await OfflineSyncManager.queueMutation(
        'create',
        'task',
        'task-1',
        '/api/tasks',
        'POST'
      )

      // Mark as failed
      await offlineDB.mutations.update(mutation.id, {
        status: 'failed',
        retryCount: 3,
        lastError: 'Previous error'
      })

      // Go online and mock successful response for retry
      mockNavigator(true)
      ;(global.fetch as any).mockResolvedValueOnce(
        new Response(JSON.stringify({ task: { id: 'task-1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )

      await OfflineSyncManager.retryFailedMutations()

      // Should have synced successfully
      const remaining = await offlineDB.mutations.get(mutation.id)
      expect(remaining).toBeUndefined() // Removed after successful sync
    })
  })

  describe('cancelMutation', () => {
    it('should remove mutation from queue', async () => {
      // Go offline to prevent auto-sync
      mockNavigator(false)

      const mutation = await OfflineSyncManager.queueMutation(
        'create',
        'task',
        'task-1',
        '/api/tasks',
        'POST'
      )

      await OfflineSyncManager.cancelMutation(mutation.id)

      const stored = await offlineDB.mutations.get(mutation.id)
      expect(stored).toBeUndefined()
    })
  })
})

describe('Offline utility functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('isOfflineMode', () => {
    it('should return true when offline', () => {
      mockNavigator(false)
      expect(isOfflineMode()).toBe(true)
    })

    it('should return false when online', () => {
      mockNavigator(true)
      expect(isOfflineMode()).toBe(false)
    })
  })

  describe('waitForOnline', () => {
    it('should resolve immediately if already online', async () => {
      mockNavigator(true)

      const start = Date.now()
      await waitForOnline()
      const duration = Date.now() - start

      expect(duration).toBeLessThan(10)
    })

    it('should wait for online event if offline', async () => {
      mockNavigator(false)

      const waitPromise = waitForOnline()

      // Simulate coming online after 100ms
      setTimeout(() => {
        mockNavigator(true)
        window.dispatchEvent(new Event('online'))
      }, 100)

      const start = Date.now()
      await waitPromise
      const duration = Date.now() - start

      expect(duration).toBeGreaterThanOrEqual(90)
    })
  })
})
