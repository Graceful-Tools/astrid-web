/**
 * `apiPatch` (task b8b21855).
 *
 * lib/api.ts shipped apiPost/apiPut/apiDelete and no PATCH helper. That gap is
 * not cosmetic: it is why the two "favorite this list" call sites
 * (components/list-sort-and-filters.tsx, hooks/useTaskManagerController.ts)
 * were still raw `fetch`. `PATCH /api/v1/lists/{id}/favorite` is the only way
 * a non-owner member can favourite a list, so there was no PUT to reach for —
 * the choice was a raw fetch or nothing, and the offline queue never saw it.
 *
 * Favouriting offline and having it stick on reconnect is the whole point, so
 * these assert the QUEUEING, not that a helper exists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const queueMutation = vi.fn()
let offline = true

vi.mock('@/lib/offline-sync', () => ({
  OfflineSyncManager: { queueMutation: (...a: unknown[]) => queueMutation(...a) },
  isOfflineMode: () => offline,
}))

vi.mock('@/lib/offline-db', () => ({
  OfflineTaskOperations: {
    saveTask: vi.fn(),
    deleteTask: vi.fn(),
    getTask: vi.fn(async () => null),
    getTasks: vi.fn(async () => []),
  },
  OfflineListOperations: { saveList: vi.fn(), deleteList: vi.fn(), getList: vi.fn(async () => null) },
  OfflineIdMappingOperations: { getRealId: vi.fn(async () => null) },
}))

beforeEach(() => {
  vi.clearAllMocks()
  offline = true
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }))
})

describe('apiPatch queues like the other writes (task b8b21855)', () => {
  it('queues PATCH /api/v1/lists/:id/favorite — the member-safe favourite route', async () => {
    const { apiPatch } = await import('@/lib/api')
    await apiPatch('/api/v1/lists/list-1/favorite', { isFavorite: true })

    expect(queueMutation).toHaveBeenCalledWith(
      'update',
      'list',
      'list-1',
      '/api/v1/lists/list-1/favorite',
      'PATCH',
      { isFavorite: true },
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('queues PATCH on a task record', async () => {
    const { apiPatch } = await import('@/lib/api')
    await apiPatch('/api/v1/tasks/task-1', { completed: true })

    expect(queueMutation).toHaveBeenCalledWith(
      'update', 'task', 'task-1', '/api/v1/tasks/task-1', 'PATCH', { completed: true },
    )
  })

  it('replays the PATCH as a PATCH, not as a PUT', async () => {
    // The queued method is what the replay re-issues. /favorite exports PATCH
    // only, so a mutation recorded as PUT would 405 on reconnect — the edit
    // would look queued and then quietly die.
    const { apiPatch } = await import('@/lib/api')
    await apiPatch('/api/v1/lists/list-1/favorite', { isFavorite: false })

    expect(queueMutation.mock.calls[0][4]).toBe('PATCH')
  })

  it('does not queue a PATCH to an unrelated route', async () => {
    const { apiPatch } = await import('@/lib/api')
    await apiPatch('/api/v1/users/me/settings', { theme: 'dark' })

    expect(queueMutation).not.toHaveBeenCalled()
  })

  it('goes straight to the network when online', async () => {
    offline = false
    const { apiPatch } = await import('@/lib/api')
    await apiPatch('/api/v1/lists/list-1/favorite', { isFavorite: true })

    expect(queueMutation).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/lists/list-1/favorite',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ isFavorite: true }) }),
    )
  })
})
