/**
 * @vitest-environment node
 *
 * Every visit to astrid.cc re-fetched everything. The app has a full Dexie /
 * IndexedDB layer and a DataSyncManager that correctly does delta sync — but
 * the render path ignored it. useTaskListState.loadData issued four
 * unconditional full fetches (/api/tasks, /api/lists, /api/public-tasks,
 * /api/lists/public) through a bare `fetch`, with `loading` starting true, so
 * the first paint waited on ~1.9 MB of tasks measured against production.
 *
 * The cache was effectively write-only: the sync engine filled it, nothing read
 * it back.
 *
 * These pin the read path, which is the part that was missing:
 *   1. cached tasks/lists are shown before any network call
 *   2. the reconcile fetch asks for a delta when a cursor exists
 *   3. a cold cache still does a full fetch
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getTasks = vi.fn()
const getLists = vi.fn()
const getCursor = vi.fn()

vi.mock('@/lib/offline-db', () => ({
  OfflineTaskOperations: { getTasks: (...a: unknown[]) => getTasks(...a) },
  OfflineListOperations: { getLists: (...a: unknown[]) => getLists(...a) },
  OfflineSyncCursorOperations: { getCursor: (...a: unknown[]) => getCursor(...a) },
}))

import { seedFromCache, buildTaskSyncUrl } from '@/hooks/task-manager/load-from-cache'

beforeEach(() => {
  getTasks.mockReset()
  getLists.mockReset()
  getCursor.mockReset()
  getTasks.mockResolvedValue([])
  getLists.mockResolvedValue([])
  getCursor.mockResolvedValue(undefined)
})

describe('first paint comes from IndexedDB, not the network', () => {
  it('returns cached tasks and lists without touching the network', async () => {
    getTasks.mockResolvedValue([{ id: 't1' }, { id: 't2' }])
    getLists.mockResolvedValue([{ id: 'l1' }])
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const seeded = await seedFromCache()

    expect(seeded.tasks).toHaveLength(2)
    expect(seeded.lists).toHaveLength(1)
    expect(seeded.hasData).toBe(true)
    // The whole point: paint before any request goes out.
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('reports an empty cache so the caller keeps its loading state', async () => {
    const seeded = await seedFromCache()

    expect(seeded.hasData).toBe(false)
  })

  it('never throws when IndexedDB is unavailable', async () => {
    // Private browsing, quota errors, blocked upgrades — a cache failure must
    // degrade to a normal network load, not break the app.
    getTasks.mockRejectedValue(new Error('IndexedDB unavailable'))

    const seeded = await seedFromCache()

    expect(seeded.hasData).toBe(false)
    expect(seeded.tasks).toEqual([])
  })
})

describe('the reconcile fetch asks for a delta when it can', () => {
  it('appends updatedSince when a cursor exists', async () => {
    getCursor.mockResolvedValue({ entity: 'task', cursor: '2026-07-26T12:00:00.000Z', lastSync: Date.now() })

    const url = await buildTaskSyncUrl('/api/tasks')

    expect(url).toContain('updatedSince=')
    expect(url).toContain(encodeURIComponent('2026-07-26T12:00:00.000Z'))
  })

  it('falls back to a full fetch when there is no cursor', async () => {
    const url = await buildTaskSyncUrl('/api/tasks')

    expect(url).toBe('/api/tasks')
  })

  it('falls back to a full fetch when the cursor is unreadable', async () => {
    getCursor.mockRejectedValue(new Error('boom'))

    const url = await buildTaskSyncUrl('/api/tasks')

    expect(url).toBe('/api/tasks')
  })
})
