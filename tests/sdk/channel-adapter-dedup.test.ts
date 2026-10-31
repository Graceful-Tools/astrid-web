/**
 * @vitest-environment node
 *
 * Channel Adapter Session-Aware Dedup Tests
 *
 * Drives the real astridChannel adapter (packages/astrid-sdk/src/channel/channel.ts)
 * over scripted SSE streams, with only fetch faked, and checks that its
 * task.assigned handler skips duplicate dispatches while a session exists.
 * This file used to re-implement the handler inside the test (AWTD-1433).
 *
 * The SSE client dedups identical events for five minutes before the adapter
 * sees them, so a repeat the adapter itself must absorb arrives on a later
 * connection, past that window.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSdkSseHarness, frame } from '../fixtures/sdk-sse'
import { astridChannel } from '../../packages/astrid-sdk/src/channel/channel'
import type { InboundMessage } from '../../packages/astrid-sdk/src/channel/types'

const PAST_SSE_DEDUP_WINDOW_MS = 6 * 60_000
const RECONNECT_WAIT_MS = 10_000

let harness: ReturnType<typeof createSdkSseHarness>
let adapter: ReturnType<typeof astridChannel.createAdapter>
let onMessage: ReturnType<typeof vi.fn<(msg: InboundMessage) => void>>

beforeEach(() => {
  vi.useFakeTimers()
  harness = createSdkSseHarness()
  adapter = astridChannel.createAdapter({
    enabled: true,
    clientId: 'client-id',
    clientSecret: 'client-secret',
    apiBase: 'https://sdk-test.example/api/v1',
  })
  onMessage = vi.fn<(msg: InboundMessage) => void>()
})

afterEach(async () => {
  await adapter.disconnect()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const assigned = (id: string, title: string) =>
  frame({ taskId: id, task: { id, title, priority: 0, comments: [] } }, { event: 'task.assigned' })
const completed = (id: string) => frame({ taskId: id }, { event: 'task.completed' })
const deleted = (id: string) => frame({ taskId: id }, { event: 'task.deleted' })
const commented = (id: string, commentId: string, content: string) =>
  frame({ taskId: id, comment: { id: commentId, content } }, { event: 'task.commented' })

/** Stream each batch on its own connection, a dedup window apart. */
async function run(...streams: string[][]) {
  for (const chunks of streams) harness.enqueue(...chunks)
  await adapter.connect(onMessage)
  for (let i = 1; i < streams.length; i++) {
    vi.setSystemTime(Date.now() + PAST_SSE_DEDUP_WINDOW_MS)
    await vi.advanceTimersByTimeAsync(RECONNECT_WAIT_MS)
  }
}

describe('Channel Adapter — Session-Aware Dedup', () => {
  it('should dispatch onMessage on first task.assigned', async () => {
    await run([assigned('task-1', 'Fix bug')])

    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Fix bug'),
        sessionKey: 'astrid:task:task-1',
      })
    )
  })

  it('should NOT dispatch onMessage on second task.assigned for same taskId', async () => {
    await run([assigned('task-1', 'Fix bug')], [assigned('task-1', 'Fix bug')])

    expect(onMessage).toHaveBeenCalledTimes(1)
  })

  it('should dispatch onMessage for different taskIds', async () => {
    await run([assigned('task-1', 'Fix bug'), assigned('task-2', 'Add feature')])

    expect(onMessage).toHaveBeenCalledTimes(2)
  })

  it('should dispatch onMessage again after task.completed ends session', async () => {
    await run(
      [assigned('task-1', 'Fix bug'), completed('task-1')],
      [assigned('task-1', 'Fix bug (reopened)')]
    )

    expect(onMessage).toHaveBeenCalledTimes(2)
    expect(onMessage.mock.calls[1][0].content).toContain('Fix bug (reopened)')
  })

  it('should dispatch onMessage again after task.deleted ends session', async () => {
    await run(
      [assigned('task-1', 'Fix bug'), deleted('task-1')],
      [assigned('task-1', 'Fix bug (recreated)')]
    )

    expect(onMessage).toHaveBeenCalledTimes(2)
    expect(onMessage.mock.calls[1][0].content).toContain('Fix bug (recreated)')
  })

  it('should skip task.assigned when task data is missing', async () => {
    await run([frame({ taskId: 'task-1' }, { event: 'task.assigned' })])

    expect(onMessage).not.toHaveBeenCalled()
  })

  it('should skip task.commented when no session exists', async () => {
    await run([commented('task-unknown', 'c-1', 'hello')])

    expect(onMessage).not.toHaveBeenCalled()
  })

  it('should deliver task.commented when session exists', async () => {
    await run([assigned('task-1', 'Fix bug'), commented('task-1', 'c-1', 'Working on it')])

    expect(onMessage).toHaveBeenCalledTimes(2) // assigned + comment
    expect(onMessage.mock.calls[1][0].content).toContain('Working on it')
  })
})
