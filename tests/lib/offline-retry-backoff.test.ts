/**
 * RED for task b8b21855-79d5-4c62-ade3-1789ecb0b3d4.
 *
 * OfflineSyncManager declared `retryDelay = 1000 // 1 second base delay` and
 * never read it. A mutation that failed was written back with status 'pending',
 * so the very next sync pass — which can be milliseconds later, since a pass is
 * triggered by `online`, by cross-tab events and by every queueMutation call —
 * retried it immediately. Three passes in a row burn all three retries and the
 * mutation is marked 'failed' having never waited for anything, which is the
 * opposite of what a backoff is for: a mutation failing because the network
 * just came back gets no chance to succeed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

global.fetch = vi.fn()

vi.mock('@/lib/api', () => ({
  apiCall: async (endpoint: string, options: any = {}) =>
    await (global.fetch as any)(endpoint, options),
}))

import { OfflineSyncManager } from '@/lib/offline-sync'
import { offlineDB } from '@/lib/offline-db'
import { retryBackoffMs, isDueForRetry } from '@/lib/offline-retry-schedule'

function online(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { writable: true, value })
}

function failOnce() {
  ;(global.fetch as any).mockRejectedValueOnce(new Error('network down'))
}

function succeed() {
  ;(global.fetch as any).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, id: 'real-1' }),
    text: async () => JSON.stringify({ success: true, id: 'real-1' }),
    headers: new Headers(),
  })
}

describe.sequential('offline replay backoff (task b8b21855)', () => {
  beforeEach(async () => {
    await new Promise((r) => setTimeout(r, 20))
    await offlineDB.clearAll()
    vi.clearAllMocks()
    ;(global.fetch as any).mockReset()
    succeed()
    online(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('grows the delay with each retry, starting at the declared base', () => {
    expect(retryBackoffMs(1)).toBe(1000)
    expect(retryBackoffMs(2)).toBe(2000)
    expect(retryBackoffMs(3)).toBe(4000)
  })

  it('treats a mutation with no schedule as due, so a first attempt is never delayed', () => {
    expect(isDueForRetry({}, Date.now())).toBe(true)
  })

  it('does not retry a just-failed mutation on the very next pass', async () => {
    // Queue while offline: queueMutation kicks off a sync of its own when
    // navigator.onLine, which would consume the mocked failure before the
    // assertions below could see it.
    online(false)
    await OfflineSyncManager.queueMutation('update', 'task', 't1', '/api/v1/tasks/t1', 'PATCH', {
      title: 'x',
    })
    online(true)

    failOnce()
    await OfflineSyncManager.syncPendingMutations()

    const [afterFirst] = await offlineDB.mutations.toArray()
    expect(afterFirst.retryCount).toBe(1)

    const callsAfterFirstPass = (global.fetch as any).mock.calls.length
    await OfflineSyncManager.syncPendingMutations()

    expect((global.fetch as any).mock.calls.length).toBe(callsAfterFirstPass)
    const [afterSecond] = await offlineDB.mutations.toArray()
    expect(afterSecond.retryCount).toBe(1)
  })

  it('retries once the backoff has elapsed', async () => {
    online(false)
    await OfflineSyncManager.queueMutation('update', 'task', 't2', '/api/v1/tasks/t2', 'PATCH', {
      title: 'y',
    })
    online(true)

    failOnce()
    await OfflineSyncManager.syncPendingMutations()

    const [queued] = await offlineDB.mutations.toArray()
    expect(queued.nextAttemptAt).toBeGreaterThan(Date.now())

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(queued.nextAttemptAt! + 1))

    const result = await OfflineSyncManager.syncPendingMutations()
    expect(result.success).toBe(1)
    expect(await offlineDB.mutations.toArray()).toHaveLength(0)
  })
})
