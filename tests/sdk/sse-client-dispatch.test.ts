/**
 * @vitest-environment node
 *
 * SSE Client Dispatch Tests
 *
 * Drives the real SDK SSEClient over a scripted SSE stream (only fetch is
 * faked) and checks that internal server event types are mapped to protocol
 * event names and that unnamed events are unwrapped before handlers see them.
 * This file used to test an in-file copy of the client's logic (AWTD-1422).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSdkSseHarness, frame } from '../fixtures/sdk-sse'

// agent-protocol pulls in prisma and the auth middleware; mapEventType needs neither.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/api-auth-middleware', () => ({
  authenticateAPI: vi.fn(),
  UnauthorizedError: class extends Error {},
  ForbiddenError: class extends Error {},
}))
vi.mock('@/lib/oauth/oauth-scopes', () => ({
  hasRequiredScopes: vi.fn().mockReturnValue(true),
}))

import { AGENT_EVENT_TYPES, mapEventType as serverMapEventType } from '@/lib/agent-protocol'

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

/** Stream one unnamed (broadcastToUsers-style) event and return what handlers saw. */
async function dispatchUnnamed(internalType: string, taskId: string) {
  await harness.connect(frame({ type: internalType, data: { taskId } }))
  return harness.received.at(-1)
}

describe('SDK SSE Client — event type mapping', () => {
  it.each([
    ['task_assigned', 'task.assigned'],
    ['task_created', 'task.assigned'],
    ['task_updated', 'task.updated'],
    ['task_completed', 'task.completed'],
    ['task_deleted', 'task.deleted'],
    ['comment_created', 'task.commented'],
    ['comment_added', 'task.commented'],
    ['agent_task_comment', 'task.commented'],
  ])('should map %s to %s', async (internal, protocol) => {
    const event = await dispatchUnnamed(internal, `task-${internal}`)
    expect(event?.type).toBe(protocol)
  })

  it('should pass through unknown event types unchanged', async () => {
    const event = await dispatchUnnamed('custom_event', 'task-x')
    expect(event?.type).toBe('custom_event')
  })
})

describe('SDK SSE Client — dispatch (unnamed event unwrapping)', () => {
  it('should unwrap unnamed message events with internal type', async () => {
    await harness.connect(
      frame({
        type: 'task_assigned',
        timestamp: '2025-06-01T00:00:00Z',
        data: { taskId: 'task-1', task: { id: 'task-1', title: 'Test' } },
      })
    )

    expect(harness.received).toHaveLength(1)
    expect(harness.received[0].type).toBe('task.assigned')
    expect(harness.received[0].data.taskId).toBe('task-1')
    expect(harness.received[0].data.task).toEqual({ id: 'task-1', title: 'Test' })
  })

  it('should unwrap unnamed comment events', async () => {
    await harness.connect(
      frame({
        type: 'comment_created',
        timestamp: '2025-06-01T00:00:00Z',
        data: {
          taskId: 'task-1',
          commentId: 'comment-1',
          comment: { id: 'comment-1', content: 'Hello' },
        },
      })
    )

    expect(harness.received[0].type).toBe('task.commented')
    expect(harness.received[0].data.commentId).toBe('comment-1')
  })

  it('should unwrap agent_task_comment events', async () => {
    await harness.connect(
      frame({
        type: 'agent_task_comment',
        timestamp: '2025-06-01T00:00:00Z',
        data: { taskId: 'task-1', comment: { id: 'c-1', content: 'Agent reply' } },
      })
    )

    expect(harness.received[0].type).toBe('task.commented')
    expect(harness.received[0].data.comment?.content).toBe('Agent reply')
  })

  it('should pass through named events unchanged', async () => {
    await harness.connect(
      frame({ taskId: 'task-1', task: { id: 'task-1', title: 'Test' } }, { event: 'task.assigned' })
    )

    expect(harness.received).toHaveLength(1)
    expect(harness.received[0].type).toBe('task.assigned')
    expect(harness.received[0].data.taskId).toBe('task-1')
  })

  it('should fall back to full data when nested data is missing', async () => {
    await harness.connect(frame({ type: 'task_deleted', taskId: 'task-1' }))

    expect(harness.received[0].type).toBe('task.deleted')
    expect(harness.received[0].data.taskId).toBe('task-1')
  })

  it('should not unwrap message events without type field', async () => {
    await harness.connect(frame({ taskId: 'task-1' }))

    expect(harness.received).toHaveLength(1)
    expect(harness.received[0].type).toBe('message')
    expect(harness.received[0].data.taskId).toBe('task-1')
  })

  it('should only call handlers registered for the mapped type', async () => {
    const onUpdated = vi.fn()
    harness.client.on('task.updated', onUpdated)

    await harness.connect(frame({ type: 'task_assigned', data: { taskId: 'task-1' } }))

    expect(onUpdated).not.toHaveBeenCalled()
    expect(harness.received.map(e => e.type)).toEqual(['task.assigned'])
  })

  it('should keep dispatching to other handlers when one throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const after = vi.fn()
    harness.client.on('task.deleted', () => {
      throw new Error('boom')
    })
    harness.client.on('task.deleted', after)

    await harness.connect(frame({ type: 'task_deleted', data: { taskId: 'task-1' } }))

    expect(after).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })
})

describe('SDK SSE Client — stream framing', () => {
  it('should reassemble an unnamed event split mid-line across chunks', async () => {
    const whole = frame({ type: 'task_updated', data: { taskId: 'task-1' } })
    const cut = Math.floor(whole.length / 2)

    await harness.connect(whole.slice(0, cut), whole.slice(cut))

    expect(harness.received).toHaveLength(1)
    expect(harness.received[0]).toMatchObject({ type: 'task.updated', data: { taskId: 'task-1' } })
  })

  // KNOWN BUG (found writing AWTD-1422, not fixed here): parseBuffer only
  // carries the trailing partial LINE between reads, not the pending
  // `event:` / `id:` fields, so a named event whose `event:` line and `data:`
  // line arrive in different reads is dispatched as 'message' and never
  // reaches its task.* handler. it.fails flips red once the parser is fixed —
  // turn it into a plain `it` then.
  it.fails('should keep the event name when the frame is split after the event: line', async () => {
    await harness.connect('event: task.updated\n', 'data: {"taskId":"task-1"}\n\n')

    expect(harness.received[0]).toMatchObject({ type: 'task.updated', data: { taskId: 'task-1' } })
  })

  it('should skip comment lines and malformed JSON', async () => {
    await harness.connect(
      ': keepalive\n\n',
      'event: task.updated\ndata: {not json\n\n',
      frame({ taskId: 'task-2' }, { event: 'task.updated' })
    )

    expect(harness.received.map(e => e.data.taskId)).toEqual(['task-2'])
  })

  it('should carry the id: field through to handlers', async () => {
    await harness.connect(frame({ taskId: 'task-1' }, { event: 'task.assigned', id: 'evt-123' }))

    expect(harness.received[0].id).toBe('evt-123')
  })

  it('should leave id undefined when the frame has none', async () => {
    await harness.connect(frame({ taskId: 'task-1' }, { event: 'task.assigned' }))

    expect(harness.received[0].id).toBeUndefined()
  })
})

describe('SDK SSE Client — connection request', () => {
  it('should connect to <apiBase>/agent/events with a since cursor and the OAuth token', async () => {
    await harness.connect()

    expect(harness.sseRequests).toHaveLength(1)
    const { url, headers } = harness.sseRequests[0]
    expect(url).toMatch(/^https:\/\/sdk-test\.example\/api\/v1\/agent\/events\?since=/)
    expect(new Date(decodeURIComponent(url.split('since=')[1])).toString()).not.toBe('Invalid Date')
    expect(headers.Authorization).toBe('Bearer test-token')
    expect(headers.Accept).toBe('text/event-stream')
  })

  it('should reject when the server answers with a non-OK status', async () => {
    harness.fetchMock.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
    )
    harness.fetchMock.mockImplementationOnce(async () => new Response('nope', { status: 500 }))

    await expect(harness.client.connect()).rejects.toThrow('SSE connection failed: 500')
  })
})

describe('SDK ↔ Server Event Type Consistency', () => {
  // Every internal type the server forwards to agents must reach SDK handlers
  // under the same protocol name the server's own mapEventType gives it.
  it.each([...AGENT_EVENT_TYPES])('SDK maps %s the same way the server does', async internal => {
    const event = await dispatchUnnamed(internal, `task-${internal}`)
    expect(serverMapEventType(internal)).not.toBeNull()
    expect(event?.type).toBe(serverMapEventType(internal))
  })
})
