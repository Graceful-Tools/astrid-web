/**
 * RED for task ed1d85ba-2368-4397-b99c-e40a11c4b8d4, bullet 3.
 *
 * useTaskListState armed three independent paths to loadData: a
 * visibilitychange handler and a focus handler sharing a 60s `lastFetchTime`
 * throttle, and an SSE-reconnect handler on a separate 2s debounce with no
 * throttle at all. The two groups did not know about each other.
 *
 * That makes the most ordinary sequence in the app the expensive one: a tab
 * sits in the background long enough for the browser to kill the EventSource,
 * the user comes back, visibilitychange fires a full loadData, and ~2s later
 * the reconnected stream fires a second one. loadData is four network round
 * trips, so returning to a tab cost eight.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render } from '@testing-library/react'
import React from 'react'

const seedFromCache = vi.hoisted(() => vi.fn())
const fetchSyncPayload = vi.hoisted(() => vi.fn())
const apiGet = vi.hoisted(() => vi.fn())

// Stable across renders on purpose: loadData is memoised on `toast`, so a fresh
// object per render would rebuild loadData and re-fire the effects — a property
// of the mock, not of the hook.
const toastApi = vi.hoisted(() => ({ toast: () => undefined }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => toastApi }))
vi.mock('@/hooks/use-sse-subscription', () => ({
  useTaskSSEEvents: () => undefined,
  useSSESubscription: () => undefined,
}))
vi.mock('@/lib/api', () => ({ apiGet }))
vi.mock('@/hooks/task-manager/load-from-cache', () => ({ seedFromCache }))
vi.mock('@/hooks/task-manager/sync-fetch', () => ({ fetchSyncPayload }))
vi.mock('@/hooks/task-manager/merge-tasks', () => ({
  mergeTasks: (_a: unknown, b: unknown) => b,
  mergeLists: (_a: unknown, b: unknown) => b,
}))
vi.mock('@/lib/image-cache', () => ({ preloadUserAvatars: vi.fn() }))

// Captured so the test can play the reconnection the browser would deliver.
const reconnect = vi.hoisted(() => ({ current: null as null | (() => void) }))
vi.mock('@/lib/sse-manager', () => ({
  SSEManager: {
    onReconnection: (handler: () => void) => {
      reconnect.current = handler
      return () => { reconnect.current = null }
    },
  },
}))

const { useTaskListState } = await import('@/hooks/task-manager/useTaskListState')

function Harness() {
  useTaskListState({
    effectiveSession: { user: { id: 'user-1' } },
    selectedListId: '',
    setSelectedListId: vi.fn(),
    setSelectedTaskId: vi.fn(),
    selectedTaskId: '',
  })
  return null
}

/** Every loadData begins with seedFromCache, so it is the run counter. */
const loads = () => seedFromCache.mock.calls.length

async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function mountHarness() {
  render(<Harness />)
  await tick(0)
  return loads()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  reconnect.current = null
  seedFromCache.mockResolvedValue({ tasks: [], lists: [], hasData: false })
  fetchSyncPayload.mockResolvedValue({ tasks: [], lists: [] })
  apiGet.mockResolvedValue({ ok: true, json: async () => ({}) })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('returning to a tab refreshes once, not three times (task ed1d85ba)', () => {
  it('collapses visibilitychange, focus and an SSE reconnect into one load', async () => {
    const afterMount = await mountHarness()

    // Long enough in the background that the tab-focus throttle has expired and
    // the browser has dropped the EventSource.
    await tick(5 * 60 * 1000)

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
      reconnect.current?.()
    })
    // Past the SSE debounce, which is where the second load used to land.
    await tick(10_000)

    expect(loads()).toBe(afterMount + 1)
  })

  it('still catches up on a mid-session reconnect, which is not a tab event', async () => {
    const afterMount = await mountHarness()

    // A network blip well inside the 60s tab throttle. An SSE reconnect exists
    // to replay events missed while the stream was down; holding it for the
    // rest of the tab window would sit on them.
    await tick(20_000)
    await act(async () => { reconnect.current?.() })
    await tick(10_000)

    expect(loads()).toBe(afterMount + 1)
  })

  it('measures the throttle from the mount load, not only from tab events', async () => {
    const afterMount = await mountHarness()

    // The mount effect has just loaded. Alt-tabbing straight back does not
    // justify four more round trips.
    await tick(5_000)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    await tick(10_000)

    expect(loads()).toBe(afterMount)
  })

  it('does not start a second load while the mount load is still in flight', async () => {
    // Review follow-up: the throttle was only claimed when a load FINISHED, so
    // during the mount load — four round trips, and slow on a bad connection —
    // an alt-tab scheduled a second, concurrent load racing the first over the
    // same sync cursors. loadData has no re-entrancy guard of its own.
    fetchSyncPayload.mockReturnValue(new Promise(() => {}))

    render(<Harness />)
    await tick(0)
    expect(loads()).toBe(1)

    await tick(1_000)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    await tick(30_000)

    expect(loads()).toBe(1)
  })

  it('does eventually serve a tab return that arrived inside the throttle', async () => {
    const afterMount = await mountHarness()

    // Deferred rather than dropped: the old handlers threw this event away and
    // the tab could sit on stale data until something else happened to fire.
    await tick(5_000)
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await tick(60_000)

    expect(loads()).toBe(afterMount + 1)
  })
})
