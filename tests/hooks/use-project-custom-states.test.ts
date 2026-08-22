/**
 * Reading a board's custom states (task b346e377).
 *
 * The one behaviour worth pinning is what this returns when it does not know:
 * `undefined`, never `[]`. `getProjectBoardColumns` renders legacy
 * list-backed columns when it is given no states, so `undefined` leaves a
 * board exactly as it is today. Returning `[]` would assert "this board has no
 * custom columns" and blink them out on every load and every failed request.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
  useProjectCustomStates,
  __clearProjectCustomStatesCache,
} from '@/hooks/useProjectCustomStates'

const STATES = [{ role: 'custom-blocked', name: 'Blocked', order: 0 }]

function mockProjects(projects: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ projects }),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  __clearProjectCustomStatesCache()
  vi.clearAllMocks()
})
afterEach(() => vi.unstubAllGlobals())

describe('useProjectCustomStates (task b346e377)', () => {
  it('returns the states for the requested board', async () => {
    mockProjects([{ id: 'p1', customStates: STATES }])
    const { result } = renderHook(() => useProjectCustomStates('p1'))

    await waitFor(() => expect(result.current).toEqual(STATES))
  })

  it('is undefined before the read resolves, not empty', async () => {
    mockProjects([{ id: 'p1', customStates: STATES }])
    const { result } = renderHook(() => useProjectCustomStates('p1'))

    expect(
      result.current,
      'an empty array asserts "no custom columns" and blinks them out',
    ).toBeUndefined()
  })

  it('stays undefined when the request fails', async () => {
    mockProjects(null, false)
    const { result } = renderHook(() => useProjectCustomStates('p1'))

    // Give the rejection a chance to land.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(result.current, 'a failed read blanked the board').toBeUndefined()
  })

  it('does not fetch without a board', () => {
    const fetchMock = mockProjects([])
    const { result } = renderHook(() => useProjectCustomStates(null))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current).toBeUndefined()
  })

  it('reports an empty list for a board that has no custom states', async () => {
    // Distinct from "not loaded": the board answered, and the answer is none.
    mockProjects([{ id: 'p1' }])
    const { result } = renderHook(() => useProjectCustomStates('p1'))

    await waitFor(() => expect(result.current).toEqual([]))
  })

  it('serves a second mount from cache without refetching', async () => {
    const fetchMock = mockProjects([{ id: 'p1', customStates: STATES }])
    const first = renderHook(() => useProjectCustomStates('p1'))
    await waitFor(() => expect(first.result.current).toEqual(STATES))

    renderHook(() => useProjectCustomStates('p1'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('issues one request when two boards mount at once', async () => {
    // Switching boards is common; a request per mount is not.
    const fetchMock = mockProjects([{ id: 'p1', customStates: STATES }])
    renderHook(() => useProjectCustomStates('p1'))
    renderHook(() => useProjectCustomStates('p1'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })
})
