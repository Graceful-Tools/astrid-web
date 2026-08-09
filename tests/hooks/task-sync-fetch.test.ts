/**
 * @vitest-environment node
 *
 * The main data load, moved onto v1 (task 641a7615 step 3).
 *
 * `useTaskListState.loadData` is the app's primary read: it reconciles tasks
 * and lists against the server on every visit. Two things make moving it to v1
 * more than a path change, and both fail silently:
 *
 * 1. **v1 caps `/api/v1/tasks` at 100 rows** (legacy `/api/tasks` had no cap).
 *    A path swap alone would give every user their first 100 tasks and nothing
 *    else — no error, no empty state, just tasks that are not there. That is
 *    decision 1B's whole subject, and `fetchAllPages` exists for it.
 * 2. **`deletedIds` must survive paging.** A delta that loses page 2's
 *    deletions leaves deleted tasks resurrected in the local cache.
 *
 * Extracted from the hook so it can be tested without a React tree or a fake
 * IndexedDB — the fetching is the part with the failure modes in it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const getCursor = vi.fn()

vi.mock('@/lib/offline-db', () => ({
  OfflineTaskOperations: { getTasks: vi.fn() },
  OfflineListOperations: { getLists: vi.fn() },
  OfflineSyncCursorOperations: { getCursor: (...a: unknown[]) => getCursor(...a) },
}))

import { fetchSyncPayload } from '@/hooks/task-manager/sync-fetch'

const task = (n: number) => ({ id: `t${n}` })

/** A v1 collection page. */
const page = (key: string, items: unknown[], total: number, limit: number, extra = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({ [key]: items, meta: { total, offset: 0, limit }, ...extra }),
})

beforeEach(() => {
  vi.clearAllMocks()
  getCursor.mockResolvedValue(undefined)
})

describe('fetchSyncPayload (task 641a7615)', () => {
  it('reads tasks and lists from v1, not the legacy paths', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes('/tasks')
        ? page('tasks', [task(1)], 1, 1000)
        : page('lists', [{ id: 'l1' }], 1, 1000)
    )

    await fetchSyncPayload({ fetchImpl: fetchImpl as never })

    const urls = fetchImpl.mock.calls.map(([u]) => String(u))
    expect(urls.some((u) => u.startsWith('/api/v1/tasks'))).toBe(true)
    expect(urls.some((u) => u.startsWith('/api/v1/lists'))).toBe(true)
    expect(urls.some((u) => u.startsWith('/api/tasks') || u.startsWith('/api/lists'))).toBe(false)
  })

  it('pages past v1 100-row cap instead of returning the first page', async () => {
    // The regression this whole extraction exists to prevent: 250 tasks coming
    // back as 100, silently.
    const all = Array.from({ length: 250 }, (_, i) => task(i))
    const fetchImpl = vi.fn(async (url: string) => {
      if (!String(url).includes('/tasks')) return page('lists', [], 0, 1000)
      const offset = Number(new URL(String(url), 'http://x').searchParams.get('offset') ?? 0)
      return page('tasks', all.slice(offset, offset + 100), 250, 100)
    })

    const result = await fetchSyncPayload({ fetchImpl: fetchImpl as never })

    expect(result.tasks).toHaveLength(250)
  })

  it('keeps deletedIds from every page, not just the last', async () => {
    // Losing a page's deletions resurrects deleted tasks in the local cache.
    const fetchImpl = vi.fn(async (url: string) => {
      if (!String(url).includes('/tasks')) return page('lists', [], 0, 1000)
      const offset = Number(new URL(String(url), 'http://x').searchParams.get('offset') ?? 0)
      return offset === 0
        ? page('tasks', [task(1)], 2, 1, { deletedIds: ['d1'] })
        : page('tasks', [task(2)], 2, 1, { deletedIds: ['d2'] })
    })

    const result = await fetchSyncPayload({ fetchImpl: fetchImpl as never })

    expect(result.deletedTaskIds).toEqual(['d1', 'd2'])
  })

  it('asks for a delta when a cursor exists', async () => {
    getCursor.mockResolvedValue({ cursor: '2026-08-01T00:00:00Z' })
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes('/tasks') ? page('tasks', [], 0, 1000) : page('lists', [], 0, 1000)
    )

    const result = await fetchSyncPayload({ fetchImpl: fetchImpl as never })

    expect(fetchImpl.mock.calls.every(([u]) => String(u).includes('updatedSince='))).toBe(true)
    expect(result.tasksIsDelta).toBe(true)
    expect(result.listsIsDelta).toBe(true)
  })

  it('reports a full sync as not-a-delta', async () => {
    // mergeTasks treats a full response as the truth and a delta as a patch.
    // Getting this backwards wipes every task the response did not mention.
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes('/tasks') ? page('tasks', [task(1)], 1, 1000) : page('lists', [], 0, 1000)
    )

    const result = await fetchSyncPayload({ fetchImpl: fetchImpl as never })

    expect(result.tasksIsDelta).toBe(false)
    expect(result.listsIsDelta).toBe(false)
  })
})
