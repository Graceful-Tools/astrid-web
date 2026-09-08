/**
 * RED for task ed1d85ba-2368-4397-b99c-e40a11c4b8d4, bullet 3.
 *
 * useTaskListState armed three independent paths to loadData — a
 * visibilitychange handler and a focus handler sharing a 60s throttle, and an
 * SSE-reconnect handler on its own 2s debounce with no throttle. None of them
 * knew about the others, so the ordinary "come back to the tab, the browser had
 * killed the SSE stream, it reconnects" sequence cost two full loadData runs
 * (four network round trips each) about two seconds apart.
 *
 * These are the properties the shared scheduler has to hold for that to stop
 * being possible, tested against the pure helper rather than the hook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRefreshScheduler } from '@/lib/refresh-scheduler'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createRefreshScheduler (task ed1d85ba)', () => {
  it('serves the first request even under a long minimum interval', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const scheduler = createRefreshScheduler(run, { debounceMs: 2000 })

    // A scheduler that has never run has nothing to throttle against. Treating
    // construction as a run silently swallowed the first tab return for a
    // minute in DataSyncManager, which does not load on start-up.
    scheduler.request('visibility', { minIntervalMs: 60_000 })
    await vi.advanceTimersByTimeAsync(2000)

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('measures the interval from a run reported by notifyRan', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const scheduler = createRefreshScheduler(run, { debounceMs: 2000 })

    // The caller loaded on mount without going through the scheduler.
    scheduler.notifyRan()

    await vi.advanceTimersByTimeAsync(5_000)
    scheduler.request('visibility', { minIntervalMs: 60_000 })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('collapses a burst of requests into a single run', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const scheduler = createRefreshScheduler(run, { debounceMs: 2000 })

    // The real sequence: the tab becomes visible, the window takes focus, and
    // the SSE stream reconnects, all within a couple of seconds.
    scheduler.request('visibility')
    scheduler.request('focus')
    await vi.advanceTimersByTimeAsync(500)
    scheduler.request('sse-reconnect')

    await vi.advanceTimersByTimeAsync(2000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('tells the run which reasons it is serving, deduplicated', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const scheduler = createRefreshScheduler(run, { debounceMs: 2000 })

    scheduler.request('visibility')
    scheduler.request('focus')
    scheduler.request('visibility')
    await vi.advanceTimersByTimeAsync(2000)

    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0].sort()).toEqual(['focus', 'visibility'])
  })

  it('holds a request back until its minimum interval since the last run has passed', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const scheduler = createRefreshScheduler(run, { debounceMs: 2000 })

    scheduler.request('mount', { minIntervalMs: 0 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(run).toHaveBeenCalledTimes(1)

    // 10s later the tab comes back. The old code dropped this outright; the
    // scheduler defers it to the end of the 60s window instead.
    await vi.advanceTimersByTimeAsync(10_000)
    scheduler.request('visibility', { minIntervalMs: 60_000 })

    await vi.advanceTimersByTimeAsync(2000)
    expect(run).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(48_000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('lets an urgent reason run on its own shorter interval', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const scheduler = createRefreshScheduler(run, { debounceMs: 2000 })

    scheduler.request('mount', { minIntervalMs: 0 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(run).toHaveBeenCalledTimes(1)

    // A mid-session network blip 30s in. An SSE reconnect exists to catch up on
    // events missed while the stream was down; making it wait out the 60s tab
    // throttle would sit on them. It keeps its own short interval.
    await vi.advanceTimersByTimeAsync(30_000)
    scheduler.request('sse-reconnect', { minIntervalMs: 2000 })

    await vi.advanceTimersByTimeAsync(2000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('runs at the earliest time any pending reason allows', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const scheduler = createRefreshScheduler(run, { debounceMs: 2000 })

    scheduler.request('mount', { minIntervalMs: 0 })
    await vi.advanceTimersByTimeAsync(2000)
    run.mockClear()

    // Both land at once; the throttled one must not delay the urgent one, and
    // the urgent one must not be counted twice.
    scheduler.request('visibility', { minIntervalMs: 60_000 })
    scheduler.request('sse-reconnect', { minIntervalMs: 2000 })

    await vi.advanceTimersByTimeAsync(2000)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0].sort()).toEqual(['sse-reconnect', 'visibility'])
  })

  it('does not start a second run while one is still in flight', async () => {
    let release: (() => void) | undefined
    const run = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
    const scheduler = createRefreshScheduler(run, { debounceMs: 2000 })

    scheduler.request('mount', { minIntervalMs: 0 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(run).toHaveBeenCalledTimes(1)

    // loadData is four round trips; on a slow connection the next trigger
    // arrives while it is still running.
    scheduler.request('sse-reconnect', { minIntervalMs: 0 })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).toHaveBeenCalledTimes(1)

    release?.()
    await vi.advanceTimersByTimeAsync(2000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('keeps scheduling after a run rejects', async () => {
    const run = vi.fn().mockRejectedValue(new Error('offline'))
    const scheduler = createRefreshScheduler(run, { debounceMs: 2000 })

    scheduler.request('mount', { minIntervalMs: 0 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(run).toHaveBeenCalledTimes(1)

    scheduler.request('focus', { minIntervalMs: 0 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('cancels a pending run on teardown', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const scheduler = createRefreshScheduler(run, { debounceMs: 2000 })

    scheduler.request('visibility')
    scheduler.cancel()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(run).not.toHaveBeenCalled()
  })
})

/**
 * Review follow-ups: `lastRunAt` can move after a request is armed, and the
 * scheduled time has to move with it. Both of these fired a run inside the very
 * interval it was enforcing.
 */
describe('a run reported mid-wait moves the pending run out (task ed1d85ba)', () => {
  beforeEach(() => vi.useFakeTimers())

  it('re-measures a pending request against a manual refresh', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const scheduler = createRefreshScheduler(run, { debounceMs: 2000 })

    scheduler.notifyRan()
    await vi.advanceTimersByTimeAsync(1000)
    scheduler.request('visibility', { minIntervalMs: 60_000 })

    // The user hits refresh by hand 40s in. The tab refresh armed for ~60s is
    // now redundant, and firing it would be a second full reload 20s later.
    await vi.advanceTimersByTimeAsync(39_000)
    scheduler.notifyRan()

    await vi.advanceTimersByTimeAsync(25_000)
    expect(run).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(40_000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does not let a request repeated in a burst push its own run later', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const scheduler = createRefreshScheduler(run, { debounceMs: 2000 })

    // A tab alt-tabbed repeatedly must still get its refresh on time. A debounce
    // that restarted on every event would defer the run for as long as the
    // events kept arriving, which is the opposite of the bug being fixed.
    scheduler.request('visibility')
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(500)
      scheduler.request('visibility')
    }

    // t = 1500, still inside the window opened by the FIRST request.
    expect(run).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
