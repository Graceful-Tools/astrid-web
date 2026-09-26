/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1017 — the autolinker's reader context: the project keys the reader
 * can see, and the key of the project the text belongs to (for `#N`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
  useIdentifierLinkContext,
  __clearIdentifierLinkContextCache,
} from '@/hooks/use-identifier-link-context'

const PROJECTS = [
  { id: 'p1', key: 'AWTD', lists: [{ id: 'web-board' }] },
  { id: 'p2', key: 'AITD', lists: [{ id: 'ios-board' }] },
  { id: 'p3', key: null, lists: [] },
]

function mockProjects(projects: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => ({ projects }) })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => __clearIdentifierLinkContextCache())
afterEach(() => vi.unstubAllGlobals())

describe('useIdentifierLinkContext (AWTD-1017)', () => {
  it('gives every visible key, and the project key of the text’s list', async () => {
    mockProjects(PROJECTS)
    const { result } = renderHook(() => useIdentifierLinkContext(['web-board']))
    await waitFor(() => expect(result.current).toEqual({ keys: ['AWTD', 'AITD'], projectKey: 'AWTD' }))
  })

  it('has no project key for text outside any project', async () => {
    mockProjects(PROJECTS)
    const { result } = renderHook(() => useIdentifierLinkContext(['personal']))
    await waitFor(() => expect(result.current?.projectKey).toBeNull())
    expect(result.current?.keys).toEqual(['AWTD', 'AITD'])
  })

  it('is undefined — link nothing — when the reader has no projects or the read fails', async () => {
    mockProjects([])
    const empty = renderHook(() => useIdentifierLinkContext(['web-board']))
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    expect(empty.result.current).toBeUndefined()

    __clearIdentifierLinkContextCache()
    mockProjects(null, false)
    const failed = renderHook(() => useIdentifierLinkContext(['web-board']))
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    expect(failed.result.current).toBeUndefined()
  })

  it('reads the projects once for many callers', async () => {
    const fetchMock = mockProjects(PROJECTS)
    const a = renderHook(() => useIdentifierLinkContext(['web-board']))
    const b = renderHook(() => useIdentifierLinkContext(['ios-board']))
    await waitFor(() => expect(b.result.current?.projectKey).toBe('AITD'))
    expect(a.result.current?.projectKey).toBe('AWTD')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
