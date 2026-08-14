/**
 * Task 72cb4a13 — the share-by-link flow was implemented four times: twice in
 * `task-detail.tsx` (two of which were never called), once in
 * `task-detail/TaskModals.tsx`, and once in `task-detail-viewonly.tsx`. They
 * had already drifted on error reporting.
 *
 * These tests pin the behaviour all four surfaces now share, so the next
 * divergence fails here instead of shipping.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTaskShareLink } from '@/hooks/task-detail/useTaskShareLink'

const TASK_ID = 'task-72cb4a13'

function mockFetch(response: Partial<Response> & { json: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, ...response })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('useTaskShareLink', () => {
  it('mints a shortcode for the task and exposes the returned url', async () => {
    const fetchMock = mockFetch({ json: async () => ({ url: 'https://astrid.cc/s/abc123' }) })

    const { result } = renderHook(() => useTaskShareLink(TASK_ID))
    await act(async () => {
      await result.current.openShareModal()
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/shortcodes', expect.objectContaining({
      method: 'POST',
    }))
    // targetType/targetId are the contract with POST /api/v1/shortcodes — a
    // rename on either side silently produces a 400 the user sees as "failed
    // to generate share link".
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      targetType: 'task',
      targetId: TASK_ID,
    })
    expect(result.current.shareUrl).toBe('https://astrid.cc/s/abc123')
    expect(result.current.showShareModal).toBe(true)
    expect(result.current.loadingShareUrl).toBe(false)
  })

  it('opens the modal before the request resolves, so the loading state is reachable', async () => {
    let release: (value: unknown) => void = () => {}
    global.fetch = vi.fn().mockReturnValue(
      new Promise(resolve => { release = resolve })
    ) as unknown as typeof fetch

    const { result } = renderHook(() => useTaskShareLink(TASK_ID))
    act(() => { void result.current.openShareModal() })

    await waitFor(() => expect(result.current.loadingShareUrl).toBe(true))
    expect(result.current.showShareModal).toBe(true)
    expect(result.current.shareUrl).toBeNull()

    await act(async () => {
      release({ ok: true, status: 200, json: async () => ({ url: 'https://astrid.cc/s/x' }) })
    })
    expect(result.current.loadingShareUrl).toBe(false)
  })

  it('clears loading and leaves shareUrl null when the request fails', async () => {
    mockFetch({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) })

    const { result } = renderHook(() => useTaskShareLink(TASK_ID))
    await act(async () => {
      await result.current.openShareModal()
    })

    // loadingShareUrl false + shareUrl null is what renders the failure copy.
    // Leaving loading true on the error path is the bug this pins: the modal
    // would spin forever rather than say the share failed.
    expect(result.current.loadingShareUrl).toBe(false)
    expect(result.current.shareUrl).toBeNull()
    expect(result.current.showShareModal).toBe(true)
  })

  it('treats a 200 with no url as a failure rather than a share of "undefined"', async () => {
    mockFetch({ json: async () => ({ shortcode: 'abc' }) })

    const { result } = renderHook(() => useTaskShareLink(TASK_ID))
    await act(async () => {
      await result.current.openShareModal()
    })

    expect(result.current.shareUrl).toBeNull()
    expect(result.current.loadingShareUrl).toBe(false)
  })

  it('clears loading when fetch itself throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch

    const { result } = renderHook(() => useTaskShareLink(TASK_ID))
    await act(async () => {
      await result.current.openShareModal()
    })

    expect(result.current.loadingShareUrl).toBe(false)
    expect(result.current.shareUrl).toBeNull()
  })

  it('copies the url and resets the copied flag after 2s', async () => {
    vi.useFakeTimers()
    mockFetch({ json: async () => ({ url: 'https://astrid.cc/s/abc123' }) })

    const { result } = renderHook(() => useTaskShareLink(TASK_ID))
    await act(async () => { await result.current.openShareModal() })
    await act(async () => { await result.current.copyShareUrl() })

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://astrid.cc/s/abc123')
    expect(result.current.shareUrlCopied).toBe(true)

    act(() => { vi.advanceTimersByTime(2000) })
    expect(result.current.shareUrlCopied).toBe(false)
  })

  // Moved here from tests/components/task-detail/TaskModals.test.tsx, which
  // used to own the clipboard call and so owned this case too.
  it('reports a clipboard failure without marking the url copied', async () => {
    mockFetch({ json: async () => ({ url: 'https://astrid.cc/s/abc123' }) })
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard error'))
    Object.assign(navigator, { clipboard: { writeText } })

    const { result } = renderHook(() => useTaskShareLink(TASK_ID))
    await act(async () => { await result.current.openShareModal() })
    await act(async () => { await result.current.copyShareUrl() })

    expect(console.error).toHaveBeenCalledWith('Failed to copy URL:', expect.any(Error))
    // The user must not see "Copied!" when nothing reached the clipboard.
    expect(result.current.shareUrlCopied).toBe(false)
  })

  it('does not touch the clipboard when there is no url to copy', async () => {
    const { result } = renderHook(() => useTaskShareLink(TASK_ID))
    await act(async () => { await result.current.copyShareUrl() })

    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    expect(result.current.shareUrlCopied).toBe(false)
  })

  it('drops the url on close, so reopening cannot show the previous task\'s link', async () => {
    mockFetch({ json: async () => ({ url: 'https://astrid.cc/s/abc123' }) })

    const { result } = renderHook(() => useTaskShareLink(TASK_ID))
    await act(async () => { await result.current.openShareModal() })
    act(() => { result.current.closeShareModal() })

    expect(result.current.showShareModal).toBe(false)
    expect(result.current.shareUrl).toBeNull()
    expect(result.current.shareUrlCopied).toBe(false)
  })
})
