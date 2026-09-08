/**
 * RED for task ed1d85ba-2368-4397-b99c-e40a11c4b8d4, bullet 3 — the third
 * trigger, in the other subsystem.
 *
 * DataSyncManager arms its own visibilitychange handler and its own 5-minute
 * interval, neither throttled against the other and neither aware of the
 * refresh useTaskListState runs on the very same event. Alt-tabbing three times
 * in half a minute was three network incremental syncs; a periodic tick landing
 * just after a tab return was a fourth that had nothing to fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

let mockOnline = true
vi.stubGlobal('navigator', { get onLine() { return mockOnline } })

// Captured so the test can play the events the browser would deliver.
const documentHandlers = new Map<string, () => void>()
const windowHandlers = new Map<string, () => void>()
vi.stubGlobal('document', {
  hidden: false,
  addEventListener: (type: string, handler: () => void) => { documentHandlers.set(type, handler) },
  removeEventListener: (type: string) => { documentHandlers.delete(type) },
})
vi.stubGlobal('window', {
  addEventListener: (type: string, handler: () => void) => { windowHandlers.set(type, handler) },
  removeEventListener: (type: string) => { windowHandlers.delete(type) },
})

vi.mock('@/lib/cache-manager', () => ({
  CacheManager: {
    setTasks: vi.fn(), setTask: vi.fn(), setLists: vi.fn(), setList: vi.fn(),
    removeTask: vi.fn(), removeList: vi.fn(),
    getCommentsByTask: vi.fn().mockResolvedValue({ data: [] }),
    setComment: vi.fn(), clearAll: vi.fn(),
  },
}))
vi.mock('@/lib/offline-sync', () => ({
  OfflineSyncManager: {
    syncPendingMutations: vi.fn().mockResolvedValue({ success: 0, failed: 0, errors: [] }),
    getMutationStats: vi.fn().mockResolvedValue({ pending: 0, failed: 0, completed: 0 }),
  },
}))
vi.mock('@/lib/offline-db', () => ({
  OfflineSyncCursorOperations: {
    getAllCursors: vi.fn().mockResolvedValue([]),
    getCursor: vi.fn().mockResolvedValue(null),
    setCursor: vi.fn(),
    clearAllCursors: vi.fn(),
  },
}))
vi.mock('@/lib/cross-tab-sync', () => ({ CrossTabSync: { broadcastCacheUpdated: vi.fn() } }))

let DataSyncManager: any
let syncSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  documentHandlers.clear()
  windowHandlers.clear()
  mockOnline = true
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ tasks: [], lists: [] }) })

  // Importing constructs the singleton, which registers the listeners.
  DataSyncManager = (await import('@/lib/data-sync')).DataSyncManager
  syncSpy = vi.spyOn(DataSyncManager, 'performIncrementalSync').mockResolvedValue({
    status: 'success', tasksUpdated: 0, listsUpdated: 0, commentsUpdated: 0,
    deletedIds: [], duration: 0,
  })
})

afterEach(() => {
  DataSyncManager?.cleanup?.()
  vi.useRealTimers()
  vi.clearAllMocks()
})

const tabReturns = () => documentHandlers.get('visibilitychange')?.()
const cameOnline = () => windowHandlers.get('online')?.()

describe('DataSyncManager coalesces its own triggers (task ed1d85ba)', () => {
  it('does not sync once per alt-tab', async () => {
    tabReturns()
    await vi.advanceTimersByTimeAsync(5_000)
    tabReturns()
    await vi.advanceTimersByTimeAsync(5_000)
    tabReturns()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(syncSpy).toHaveBeenCalledTimes(1)
  })

  it('does not run a periodic tick that a tab return has just made redundant', async () => {
    tabReturns()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(syncSpy).toHaveBeenCalledTimes(1)

    // The 5-minute interval lands 10s after that sync with nothing to fetch.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 10_000)
    expect(syncSpy).toHaveBeenCalledTimes(1)
  })

  it('still syncs promptly when the network comes back', async () => {
    tabReturns()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(syncSpy).toHaveBeenCalledTimes(1)

    // Reconnecting is a catch-up, not a tab event: holding it for the rest of
    // the tab window would sit on everything missed while offline.
    cameOnline()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(syncSpy).toHaveBeenCalledTimes(2)
  })

  it('stops scheduling after cleanup', async () => {
    tabReturns()
    DataSyncManager.cleanup()
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)

    expect(syncSpy).not.toHaveBeenCalled()
  })
})

/**
 * Review follow-up: the onLine / hidden guards were evaluated only where the
 * sync was REQUESTED. A deferred request waits out its minimum interval — up to
 * five minutes for the periodic one — so by the time it ran the tab could be in
 * the background or the network gone, which is exactly what the guards existed
 * to prevent.
 */
describe('deferred syncs re-check the conditions they were queued under (task ed1d85ba)', () => {
  it('does not sync into a tab that went back to the background', async () => {
    tabReturns()
    ;(globalThis as any).document.hidden = true
    await vi.advanceTimersByTimeAsync(10_000)

    expect(syncSpy).not.toHaveBeenCalled()
    ;(globalThis as any).document.hidden = false
  })

  it('does not sync after the network went away while it waited', async () => {
    tabReturns()
    mockOnline = false
    await vi.advanceTimersByTimeAsync(10_000)

    expect(syncSpy).not.toHaveBeenCalled()
    mockOnline = true
  })

  it('still lets a reconnect sync a backgrounded tab, which never needed focus', async () => {
    // The online handler was the one trigger with no visibility condition.
    ;(globalThis as any).document.hidden = true
    cameOnline()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(syncSpy).toHaveBeenCalledTimes(1)
    ;(globalThis as any).document.hidden = false
  })
})
