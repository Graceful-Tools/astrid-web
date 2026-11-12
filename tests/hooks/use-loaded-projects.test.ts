/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1582 — every list row reads the reader's boards for its status pill, so
 * the read must happen once per page, not once per row, and be shared with the
 * task-id autolinker that reads the same endpoint.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useLoadedProjects } from '@/hooks/use-loaded-projects'
import { __clearLoadedProjectsCache } from '@/lib/client-projects'

const PROJECTS = [{ id: 'p1', lists: [{ id: 'l1' }] }]

beforeEach(() => __clearLoadedProjectsCache())
afterEach(() => vi.unstubAllGlobals())

describe('useLoadedProjects (AWTD-1582)', () => {
  it('AWTD-1582: many rows share one request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) })
    vi.stubGlobal('fetch', fetchMock)
    const rows = [1, 2, 3, 4, 5].map(() => renderHook(() => useLoadedProjects()))
    for (const row of rows) await waitFor(() => expect(row.result.current).toEqual(PROJECTS))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('AWTD-1582: a failed read leaves no boards and retries next time', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useLoadedProjects())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(result.current).toEqual([])
    renderHook(() => useLoadedProjects())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('AWTD-1582: a retry that succeeds reaches the rows mounted before it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) })
    vi.stubGlobal('fetch', fetchMock)
    const early = renderHook(() => useLoadedProjects())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(early.result.current).toEqual([])
    renderHook(() => useLoadedProjects())
    await waitFor(() => expect(early.result.current).toEqual(PROJECTS))
  })
})
