/**
 * Paging through v1 collection endpoints (task 641a7615, decision 1B).
 *
 * Legacy `GET /api/tasks` returns every match. `GET /api/v1/tasks` returns the
 * first 100 unless asked otherwise. Swapping the path without paging would cap
 * every user at 100 tasks — silently, with no error and no empty state, which
 * reads as data loss rather than a bug.
 *
 * Decision 1B is to page properly rather than raise the cap. So the failure
 * modes worth pinning are all "stopped too early" and "never stopped".
 */

import { describe, it, expect, vi } from 'vitest'
import { fetchAllPages } from '@/lib/api-paginate'

const page = (items: unknown[], total: number, offset: number, limit: number) => ({
  ok: true,
  status: 200,
  json: async () => ({ tasks: items, meta: { total, offset, limit } }),
})

const task = (id: number) => ({ id: `t${id}` })

describe('fetchAllPages (task 641a7615)', () => {
  it('returns everything when it spans several pages', async () => {
    const all = Array.from({ length: 250 }, (_, i) => task(i))
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(page(all.slice(0, 100), 250, 0, 100))
      .mockResolvedValueOnce(page(all.slice(100, 200), 250, 100, 100))
      .mockResolvedValueOnce(page(all.slice(200, 250), 250, 200, 100))

    const result = await fetchAllPages('/api/v1/tasks', 'tasks', { fetchImpl: fetchImpl as never })

    expect(result.items).toHaveLength(250)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('keeps the order the server returned', async () => {
    // Order matters: these feed a manual-sort list, and re-ordering across a
    // page boundary would look like the user's arrangement being scrambled.
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(page([task(1), task(2)], 4, 0, 2))
      .mockResolvedValueOnce(page([task(3), task(4)], 4, 2, 2))

    const result = await fetchAllPages('/api/v1/tasks', 'tasks', {
      pageSize: 2,
      fetchImpl: fetchImpl as never,
    })

    expect(result.items.map((t: never) => (t as { id: string }).id)).toEqual(['t1', 't2', 't3', 't4'])
  })

  it('stops after a single request when everything fits', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(page([task(1)], 1, 0, 100))

    await fetchAllPages('/api/v1/tasks', 'tasks', { fetchImpl: fetchImpl as never })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('stops on a short page even if total claims more', async () => {
    // Defensive: if `total` is stale or wrong, trusting it alone would loop
    // forever asking for rows the server will never return.
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(page([task(1), task(2)], 999, 0, 2))
      .mockResolvedValueOnce(page([task(3)], 999, 2, 2))

    const result = await fetchAllPages('/api/v1/tasks', 'tasks', {
      pageSize: 2,
      fetchImpl: fetchImpl as never,
    })

    expect(result.items).toHaveLength(3)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('stops when the meta envelope is missing entirely', async () => {
    // A legacy-shaped response has no `meta`. One page and out, rather than
    // paging blindly against an endpoint that does not paginate.
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ tasks: [task(1)] }),
    })

    const result = await fetchAllPages('/api/v1/tasks', 'tasks', { fetchImpl: fetchImpl as never })

    expect(result.items).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('has a hard page cap so a bad server cannot spin forever', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(page([task(1), task(2)], 1e9, 0, 2))

    const result = await fetchAllPages('/api/v1/tasks', 'tasks', {
      pageSize: 2,
      maxPages: 3,
      fetchImpl: fetchImpl as never,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(result.truncated).toBe(true)
  })

  it('reports truncation rather than pretending the page cap was the end', async () => {
    // The caller has to be able to tell "that is everything" from "I gave up",
    // because the whole point of this helper is not silently losing rows.
    const fetchImpl = vi.fn().mockResolvedValue(page([task(1)], 500, 0, 1))

    const result = await fetchAllPages('/api/v1/tasks', 'tasks', {
      pageSize: 1, maxPages: 2, fetchImpl: fetchImpl as never,
    })

    expect(result.truncated).toBe(true)
  })

  it('surfaces a failed page instead of returning a partial list as complete', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(page([task(1)], 10, 0, 1))
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })

    await expect(
      fetchAllPages('/api/v1/tasks', 'tasks', { pageSize: 1, fetchImpl: fetchImpl as never }),
    ).rejects.toThrow()
  })

  it('carries query params already on the url', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(page([], 0, 0, 100))

    await fetchAllPages('/api/v1/tasks?updatedSince=2026-01-01', 'tasks', {
      fetchImpl: fetchImpl as never,
    })

    const called = String(fetchImpl.mock.calls[0][0])
    expect(called).toContain('updatedSince=2026-01-01')
    expect(called).toContain('limit=')
    expect(called).toContain('offset=0')
  })

  it('merges auxiliary arrays across pages', async () => {
    // Incremental sync also returns deletedIds; losing them on page 2 would
    // leave deleted tasks resurrected in the local cache.
    const withDeletes = (items: unknown[], deletedIds: string[], total: number, offset: number) => ({
      ok: true, status: 200,
      json: async () => ({ tasks: items, deletedIds, meta: { total, offset, limit: 1 } }),
    })
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(withDeletes([task(1)], ['d1'], 2, 0))
      .mockResolvedValueOnce(withDeletes([task(2)], ['d2'], 2, 1))

    const result = await fetchAllPages('/api/v1/tasks', 'tasks', {
      pageSize: 1, alsoCollect: 'deletedIds', fetchImpl: fetchImpl as never,
    })

    expect(result.collected).toEqual(['d1', 'd2'])
  })
})
