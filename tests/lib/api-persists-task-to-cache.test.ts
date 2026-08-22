/**
 * A confirmed task update must reach the cache (task aaccb172).
 *
 * THE PROBLEM. There are two update stacks. hooks/useTaskOperations.ts:247
 * implements the documented pattern and persists to IndexedDB on both branches.
 * hooks/useTaskManagerController.ts:573 `handleUpdateTask` does not — it is
 * optimistic and rolls back, but never calls saveTask, CacheManager.setTask or
 * queueMutation. And it is the one bound to `onUpdate`/`onUpdateTask` in
 * TaskManagerView, MainContent and project-status-board, so every field editor,
 * board card and list row inherits "no IndexedDB". An edit made while online
 * was invisible to the offline cache until a full re-sync.
 *
 * WHY THE FIX GOES IN lib/api RATHER THAN THE CONTROLLER. apiPut is the choke
 * point every write already passes through — the controller, drag-drop, and
 * call sites nobody has enumerated. Fixing it here fixes them all at once and
 * leaves the controller's optimistic/rollback logic untouched, which matters:
 * that function is the artery for every editor in the app.
 *
 * SCOPE, stated so nobody reads more into this than it does:
 *   - TASK updates only. List and comment writes still do not populate the
 *     cache; they need their own response shapes and are not what this task is
 *     about.
 *   - The SERVER-CONFIRMED task is what gets persisted, not the optimistic one.
 *     The cache should hold what the server actually stored.
 *   - A cache failure must never fail the write. CacheManager.setTask already
 *     swallows IndexedDB errors internally; this must not add a new way for a
 *     successful save to look failed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const setTask = vi.fn()

vi.mock('@/lib/cache-manager', () => ({
  CacheManager: { setTask: (...a: unknown[]) => setTask(...a) },
}))

vi.mock('@/lib/offline-sync', () => ({
  OfflineSyncManager: { queueMutation: vi.fn() },
  // Online for every case here — the offline leg is a different task.
  isOfflineMode: () => false,
}))

vi.mock('@/lib/offline-db', () => ({
  OfflineTaskOperations: {
    saveTask: vi.fn(),
    deleteTask: vi.fn(),
    getTask: vi.fn(async () => null),
  },
  OfflineListOperations: { saveList: vi.fn(), getList: vi.fn(async () => null) },
  OfflineIdMappingOperations: { getRealId: vi.fn(async () => null) },
}))

/** A v1 task PUT answers `{ task, meta }`. */
function respondWith(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      headers: { get: () => 'application/json' },
      json: async () => body,
      clone() {
        return this
      },
      text: async () => JSON.stringify(body),
    }),
  )
}

beforeEach(() => vi.clearAllMocks())

describe('a confirmed task update lands in the cache (task aaccb172)', () => {
  it('persists the task the server returned', async () => {
    const serverTask = { id: 'task-1', title: 'Renamed by server', completed: false }
    respondWith({ task: serverTask, meta: { apiVersion: 'v1' } })

    const { apiPut } = await import('@/lib/api')
    await apiPut('/api/v1/tasks/task-1', { title: 'Renamed' })

    expect(
      setTask,
      'an online edit never reached the cache — it is invisible offline until a full re-sync',
    ).toHaveBeenCalled()
    expect(setTask.mock.calls[0][0]).toMatchObject({ id: 'task-1', title: 'Renamed by server' })
  })

  it('persists the SERVER copy, not what the caller sent', async () => {
    // The server may normalise, stamp updatedAt, or reject part of the change.
    const serverTask = { id: 'task-1', title: 'Server wins', priority: 2 }
    respondWith({ task: serverTask })

    const { apiPut } = await import('@/lib/api')
    await apiPut('/api/v1/tasks/task-1', { title: 'Client guess', priority: 3 })

    expect(setTask.mock.calls[0][0]).toMatchObject({ title: 'Server wins', priority: 2 })
  })

  it('still returns a readable response to the caller', async () => {
    // The body must not be consumed by the cache write — callers .json() it.
    const serverTask = { id: 'task-1', title: 'Readable' }
    respondWith({ task: serverTask })

    const { apiPut } = await import('@/lib/api')
    const response = await apiPut('/api/v1/tasks/task-1', { title: 'Readable' })
    const body = await response.json()

    expect(body.task).toMatchObject({ id: 'task-1' })
  })

  it('does not cache a failed write', async () => {
    respondWith({ error: 'nope' }, false, 500)

    const { apiPut } = await import('@/lib/api')
    await apiPut('/api/v1/tasks/task-1', { title: 'Doomed' }).catch(() => {})

    expect(setTask, 'a rejected write was cached as if it had succeeded').not.toHaveBeenCalled()
  })

  it('does not cache a non-task write', async () => {
    respondWith({ list: { id: 'list-1', name: 'Groceries' } })

    const { apiPut } = await import('@/lib/api')
    await apiPut('/api/v1/lists/list-1', { name: 'Groceries' })

    expect(setTask, 'a list response was cached as a task').not.toHaveBeenCalled()
  })

  it('survives a cache failure without failing the write', async () => {
    setTask.mockRejectedValueOnce(new Error('IndexedDB exploded'))
    respondWith({ task: { id: 'task-1', title: 'Fine' } })

    const { apiPut } = await import('@/lib/api')
    const response = await apiPut('/api/v1/tasks/task-1', { title: 'Fine' })

    expect(response.ok, 'a cache failure turned a successful save into a failed one').toBe(true)
  })
})
