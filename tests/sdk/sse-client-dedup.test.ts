/**
 * @vitest-environment node
 *
 * SDK SSE Client Dedup Tests
 *
 * Drives the real SDK SSEClient over scripted SSE streams (only fetch is
 * faked) and checks its client-side dedup: fingerprinting, TTL behaviour,
 * unnamed/named equivalence, and persistence across reconnections. This file
 * used to test an in-file copy of the client's logic (AWTD-1422).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSdkSseHarness, frame } from '../fixtures/sdk-sse'

const DEDUP_TTL_MS = 5 * 60_000

let harness: ReturnType<typeof createSdkSseHarness>

beforeEach(() => {
  vi.useFakeTimers()
  harness = createSdkSseHarness()
})

afterEach(() => {
  harness.client.disconnect()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const named = (type: string, data: Record<string, unknown>) => frame(data, { event: type })
const unnamed = (internalType: string, data: Record<string, unknown>) =>
  frame({ type: internalType, data })

describe('SSE Client Dedup — Fingerprinting', () => {
  it('should suppress a repeat of the same task event', async () => {
    await harness.connect(
      named('task.assigned', { taskId: 'task-1' }),
      named('task.assigned', { taskId: 'task-1' })
    )
    expect(harness.received).toHaveLength(1)
  })

  it('should treat different comments on one task as different events', async () => {
    await harness.connect(
      named('task.commented', { taskId: 'task-1', comment: { id: 'comment-1' } }),
      named('task.commented', { taskId: 'task-1', comment: { id: 'comment-2' } }),
      named('task.commented', { taskId: 'task-1', comment: { id: 'comment-1' } })
    )
    expect(harness.received.map(e => e.data.comment?.id)).toEqual(['comment-1', 'comment-2'])
  })

  it('should use the fallback commentId field', async () => {
    await harness.connect(
      named('task.commented', { taskId: 'task-1', commentId: 'comment-1' }),
      // Same comment, carried on `comment.id` instead — same fingerprint
      named('task.commented', { taskId: 'task-1', comment: { id: 'comment-1' } })
    )
    expect(harness.received).toHaveLength(1)
  })

  it('should treat the same task under different protocol types as different events', async () => {
    await harness.connect(
      named('task.assigned', { taskId: 'task-1' }),
      named('task.updated', { taskId: 'task-1' })
    )
    expect(harness.received.map(e => e.type)).toEqual(['task.assigned', 'task.updated'])
  })

  it('should handle events with no taskId', async () => {
    await harness.connect(named('task.assigned', {}), named('task.assigned', {}))
    expect(harness.received).toHaveLength(1)
  })
})

describe('SSE Client Dedup — Dispatch', () => {
  it('should not suppress events with different taskIds', async () => {
    await harness.connect(
      named('task.assigned', { taskId: 'task-1' }),
      named('task.assigned', { taskId: 'task-2' })
    )
    expect(harness.received.map(e => e.data.taskId)).toEqual(['task-1', 'task-2'])
  })

  it('should dedup a named event against the same event sent unnamed', async () => {
    await harness.connect(
      named('task.assigned', { taskId: 'task-1' }),
      unnamed('task_assigned', { taskId: 'task-1' })
    )
    expect(harness.received).toHaveLength(1)
  })

  it('should dedup task_assigned and task_created for same task', async () => {
    await harness.connect(
      unnamed('task_assigned', { taskId: 'task-1' }),
      unnamed('task_created', { taskId: 'task-1' })
    )
    expect(harness.received).toHaveLength(1)
    expect(harness.received[0].type).toBe('task.assigned')
  })

  it('should deliver the same event again once the TTL has passed', async () => {
    // Move the clock without running the client's reconnect timer
    const later = (ms: number) => vi.setSystemTime(Date.now() + ms)

    await harness.connect(named('task.updated', { taskId: 'task-1' }))
    later(DEDUP_TTL_MS - 1)
    await harness.connect(named('task.updated', { taskId: 'task-1' }))
    expect(harness.received).toHaveLength(1)

    later(DEDUP_TTL_MS + 1)
    await harness.connect(named('task.updated', { taskId: 'task-1' }))
    expect(harness.received).toHaveLength(2)
  })
})

describe('SSE Client Dedup — Persistence Across Reconnections', () => {
  it('should suppress events the server replays after a reconnect', async () => {
    await harness.connect(named('task.assigned', { taskId: 'task-1' }))

    // Second connection replays task-1 (the ?since= window) and adds task-2
    await harness.connect(
      named('task.assigned', { taskId: 'task-1' }),
      named('task.assigned', { taskId: 'task-2' })
    )

    expect(harness.sseRequests).toHaveLength(2)
    expect(harness.received.map(e => e.data.taskId)).toEqual(['task-1', 'task-2'])
  })

  it('should schedule a reconnect when the stream ends', async () => {
    await harness.connect()
    expect(harness.client.isConnected()).toBe(false)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
  })
})
