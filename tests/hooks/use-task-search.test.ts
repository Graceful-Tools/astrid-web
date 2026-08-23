import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTaskSearch } from '@/hooks/use-task-search'

const { apiGetMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  apiGet: apiGetMock,
}))

const searchResponse = (taskIds: string[], nextCursor: string | null) => ({
  json: vi.fn().mockResolvedValue({
    tasks: taskIds.map(id => ({ id })),
    nextCursor,
  }),
})

describe('useTaskSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    apiGetMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('regression 59cda64b-7a1e-453a-a07d-d989eb892b03: searches every server page and clears on an empty query', async () => {
    apiGetMock
      .mockResolvedValueOnce(searchResponse(['task-1', 'task-2'], '2'))
      .mockResolvedValueOnce(searchResponse(['task-3'], null))

    const { result, rerender } = renderHook(
      ({ query }) => useTaskSearch(query),
      { initialProps: { query: 'road map' } },
    )

    expect(apiGetMock).not.toHaveBeenCalled()
    expect(result.current.isSearching).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(apiGetMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/search?q=road%20map&limit=100',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(apiGetMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/search?q=road%20map&limit=100&cursor=2',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(result.current.taskIds).toEqual(['task-1', 'task-2', 'task-3'])
    expect(result.current.isSearching).toBe(false)
    expect(result.current.error).toBeNull()

    rerender({ query: '' })

    expect(result.current.taskIds).toEqual([])
    expect(result.current.isSearching).toBe(false)
  })

  it('aborts an obsolete request so a stale response cannot replace newer results', async () => {
    let resolveFirst: (response: ReturnType<typeof searchResponse>) => void = () => {}
    apiGetMock
      .mockReturnValueOnce(new Promise(resolve => {
        resolveFirst = resolve
      }))
      .mockResolvedValueOnce(searchResponse(['new-task'], null))

    const { result, rerender } = renderHook(
      ({ query }) => useTaskSearch(query, 0),
      { initialProps: { query: 'old' } },
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const oldSignal = apiGetMock.mock.calls[0][1].signal as AbortSignal

    rerender({ query: 'new' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(oldSignal.aborted).toBe(true)
    expect(result.current.taskIds).toEqual(['new-task'])

    await act(async () => {
      resolveFirst(searchResponse(['old-task'], null))
      await Promise.resolve()
    })

    expect(result.current.taskIds).toEqual(['new-task'])
  })
})
