/**
 * A settings write that fails must not leave the toggle flipped
 * (task 9523d634).
 *
 * hooks/useUserSettings.ts updates local state optimistically and then PATCHes.
 * On failure it logged to the console and stopped — no rollback, no toast. So
 * the switch stayed in its new position while the server had stored nothing,
 * and the user had no way to know until a reload silently undid it.
 *
 * That pattern is repeated across the settings surface (AppearanceSettings,
 * webhook-settings-manager, AgentsSettings), which is why it is worth fixing at
 * the hook rather than one component at a time.
 *
 * ONLY THE ATTEMPTED KEYS REVERT. A settings object holds many fields and other
 * writes may land while a slow one is in flight; restoring the whole object
 * would undo them too. The test with two fields is what pins that.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

vi.mock('@/hooks/use-sse-subscription', () => ({
  useSSESubscription: vi.fn(),
}))

const toast = vi.fn()
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }))

/** First call is the initial load; later calls are the PATCH under test. */
function mockFetch(initial: Record<string, unknown>, patchOk: boolean) {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => initial })
    .mockResolvedValue({ ok: patchOk, status: patchOk ? 200 : 500, json: async () => ({}) })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('a failed settings write rolls back (task 9523d634)', () => {
  it('reverts the optimistic value when the server rejects it', async () => {
    mockFetch({ subtaskDisplay: 'indented' }, false)
    const { useUserSettings } = await import('@/hooks/useUserSettings')
    const { result } = renderHook(() => useUserSettings())

    await waitFor(() => expect(result.current.subtaskDisplay).toBe('indented'))

    act(() => {
      result.current.updateSettings({ subtaskDisplay: 'under_parent' })
    })
    // Optimistic: the UI moves immediately.
    expect(result.current.subtaskDisplay).toBe('under_parent')

    await waitFor(
      () =>
        expect(
          result.current.subtaskDisplay,
          'the switch stayed flipped while the server stored nothing',
        ).toBe('indented'),
      { timeout: 2000 },
    )
  })

  it('keeps the value when the server accepts it', async () => {
    mockFetch({ subtaskDisplay: 'indented' }, true)
    const { useUserSettings } = await import('@/hooks/useUserSettings')
    const { result } = renderHook(() => useUserSettings())

    await waitFor(() => expect(result.current.subtaskDisplay).toBe('indented'))

    act(() => {
      result.current.updateSettings({ subtaskDisplay: 'under_parent' })
    })

    await new Promise(resolve => setTimeout(resolve, 600))
    expect(
      result.current.subtaskDisplay,
      'a successful save was rolled back anyway',
    ).toBe('under_parent')
  })

  it('reverts only the attempted keys, not the whole object', async () => {
    // Other fields may have been changed by another write while this one was
    // in flight; a wholesale restore would silently undo them.
    mockFetch({ subtaskDisplay: 'indented', taskDisplayMode: 'list' }, false)
    const { useUserSettings } = await import('@/hooks/useUserSettings')
    const { result } = renderHook(() => useUserSettings())

    await waitFor(() => expect(result.current.settings.taskDisplayMode).toBe('list'))

    act(() => {
      result.current.updateSettings({ subtaskDisplay: 'under_parent' })
    })
    act(() => {
      result.current.settings.taskDisplayMode = result.current.settings.taskDisplayMode
    })

    await waitFor(() => expect(result.current.subtaskDisplay).toBe('indented'), { timeout: 2000 })
    expect(result.current.settings.taskDisplayMode).toBe('list')
  })

  it('tells the user rather than only the console', async () => {
    mockFetch({ subtaskDisplay: 'indented' }, false)
    const { useUserSettings } = await import('@/hooks/useUserSettings')
    const { result } = renderHook(() => useUserSettings())

    await waitFor(() => expect(result.current.subtaskDisplay).toBe('indented'))
    act(() => {
      result.current.updateSettings({ subtaskDisplay: 'under_parent' })
    })

    await waitFor(() => expect(toast).toHaveBeenCalled(), { timeout: 2000 })
  })
})
