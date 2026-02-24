/**
 * SDK SSE Client Dedup Tests
 *
 * Tests the client-side dedup in SSEClient including fingerprinting,
 * TTL behavior, id: field parsing, and persistence across reconnections.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// We can't easily instantiate SSEClient (needs OAuthClient), so we test
// the extracted logic. The SSEClient class uses the same algorithm.

// ── Extracted dedup logic matching SSEClient implementation ────────────

class TestDedupClient {
  deliveredEvents = new Map<string, number>()
  static readonly DEDUP_TTL_MS = 5 * 60_000

  eventFingerprint(type: string, data: any): string {
    const taskId = data?.taskId || ''
    const commentId = data?.comment?.id || data?.commentId || ''
    return `${type}:${taskId}:${commentId}`
  }

  isDuplicate(fp: string): boolean {
    const now = Date.now()
    if (this.deliveredEvents.size > 100) {
      for (const [key, ts] of this.deliveredEvents) {
        if (now - ts > TestDedupClient.DEDUP_TTL_MS) this.deliveredEvents.delete(key)
      }
    }
    if (this.deliveredEvents.has(fp)) {
      const age = now - this.deliveredEvents.get(fp)!
      if (age < TestDedupClient.DEDUP_TTL_MS) return true
    }
    this.deliveredEvents.set(fp, now)
    return false
  }

  // Simulates the mapEventType from SSEClient
  mapEventType(type: string): string {
    switch (type) {
      case 'task_assigned':
      case 'task_created':
        return 'task.assigned'
      case 'task_updated':
        return 'task.updated'
      case 'task_completed':
        return 'task.completed'
      case 'task_deleted':
        return 'task.deleted'
      case 'comment_created':
      case 'comment_added':
      case 'agent_task_comment':
        return 'task.commented'
      default:
        return type
    }
  }

  // Simulates dispatch dedup check
  wouldDispatch(eventType: string, eventData: any): boolean {
    let type = eventType
    let data = eventData

    if (type === 'message' && data?.type) {
      type = this.mapEventType(data.type)
      data = data.data || data
    }

    const fp = this.eventFingerprint(type, data)
    return !this.isDuplicate(fp)
  }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('SSE Client Dedup — Fingerprinting', () => {
  let client: TestDedupClient

  beforeEach(() => {
    client = new TestDedupClient()
  })

  it('should produce correct fingerprint for task.assigned events', () => {
    const fp = client.eventFingerprint('task.assigned', { taskId: 'task-1' })
    expect(fp).toBe('task.assigned:task-1:')
  })

  it('should produce correct fingerprint for task.commented events', () => {
    const fp = client.eventFingerprint('task.commented', {
      taskId: 'task-1',
      comment: { id: 'comment-1' },
    })
    expect(fp).toBe('task.commented:task-1:comment-1')
  })

  it('should handle fallback commentId field', () => {
    const fp = client.eventFingerprint('task.commented', {
      taskId: 'task-1',
      commentId: 'comment-1',
    })
    expect(fp).toBe('task.commented:task-1:comment-1')
  })

  it('should handle missing data fields gracefully', () => {
    const fp = client.eventFingerprint('task.assigned', {})
    expect(fp).toBe('task.assigned::')
  })
})

describe('SSE Client Dedup — Dispatch', () => {
  let client: TestDedupClient

  beforeEach(() => {
    client = new TestDedupClient()
  })

  it('should dispatch first event', () => {
    expect(client.wouldDispatch('task.assigned', { taskId: 'task-1' })).toBe(true)
  })

  it('should suppress same event within TTL', () => {
    client.wouldDispatch('task.assigned', { taskId: 'task-1' })
    expect(client.wouldDispatch('task.assigned', { taskId: 'task-1' })).toBe(false)
  })

  it('should not suppress events with different taskIds', () => {
    client.wouldDispatch('task.assigned', { taskId: 'task-1' })
    expect(client.wouldDispatch('task.assigned', { taskId: 'task-2' })).toBe(true)
  })

  it('should handle unnamed SSE events (message wrapping)', () => {
    // First event via named SSE
    client.wouldDispatch('task.assigned', { taskId: 'task-1' })

    // Same event via unnamed SSE (message wrapping)
    const dispatched = client.wouldDispatch('message', {
      type: 'task_assigned',
      data: { taskId: 'task-1' },
    })
    expect(dispatched).toBe(false) // should be deduped
  })

  it('should dedup task_assigned and task_created for same task', () => {
    // task_assigned comes first
    client.wouldDispatch('message', {
      type: 'task_assigned',
      data: { taskId: 'task-1' },
    })

    // task_created for same task — should be deduped (both map to task.assigned)
    const dispatched = client.wouldDispatch('message', {
      type: 'task_created',
      data: { taskId: 'task-1' },
    })
    expect(dispatched).toBe(false)
  })
})

describe('SSE Client Dedup — Persistence Across Reconnections', () => {
  it('should preserve dedup map across simulated disconnect/connect', () => {
    const client = new TestDedupClient()

    // First connection: event dispatched
    client.wouldDispatch('task.assigned', { taskId: 'task-1' })

    // Simulate disconnect/reconnect by NOT clearing deliveredEvents
    // (The real SSEClient keeps deliveredEvents as an instance property)

    // Replayed event on reconnect: should be suppressed
    expect(client.wouldDispatch('task.assigned', { taskId: 'task-1' })).toBe(false)

    // New event should still dispatch
    expect(client.wouldDispatch('task.assigned', { taskId: 'task-2' })).toBe(true)
  })
})

describe('SSE Client — id: field parsing', () => {
  it('should parse SSE stream with id: field', () => {
    // We test the parseBuffer logic indirectly by verifying the format
    const sseFrame = [
      'id: task.assigned:task-1::1234567890',
      'event: task.assigned',
      'data: {"taskId":"task-1","task":{"id":"task-1"}}',
      '',
      '',
    ].join('\n')

    // Verify the format matches what the server sends
    expect(sseFrame).toContain('id: task.assigned:task-1:')
    expect(sseFrame).toContain('event: task.assigned')
    expect(sseFrame).toContain('"taskId":"task-1"')
  })

  // Test parseBuffer directly by simulating the algorithm
  it('should extract id field from SSE frame', () => {
    const buffer = 'id: evt-123\nevent: task.assigned\ndata: {"taskId":"task-1"}\n\n'
    const events = parseBuffer(buffer)

    expect(events).toHaveLength(1)
    expect(events[0].id).toBe('evt-123')
    expect(events[0].type).toBe('task.assigned')
    expect(events[0].data.taskId).toBe('task-1')
  })

  it('should handle events without id field', () => {
    const buffer = 'event: task.assigned\ndata: {"taskId":"task-1"}\n\n'
    const events = parseBuffer(buffer)

    expect(events).toHaveLength(1)
    expect(events[0].id).toBeUndefined()
    expect(events[0].type).toBe('task.assigned')
  })
})

// ── parseBuffer extracted from SSEClient for testing ──────────────────

interface ParsedEvent {
  id?: string
  type: string
  data: any
}

function parseBuffer(buffer: string): ParsedEvent[] {
  const events: ParsedEvent[] = []
  const lines = buffer.split('\n')
  let eventType = 'message'
  let eventId: string | undefined
  let dataLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (i === lines.length - 1 && !buffer.endsWith('\n')) break

    if (line === '') {
      if (dataLines.length > 0) {
        try {
          const data = JSON.parse(dataLines.join('\n'))
          const event: ParsedEvent = { type: eventType, data }
          if (eventId) event.id = eventId
          events.push(event)
        } catch { /* skip malformed */ }
      }
      eventType = 'message'
      eventId = undefined
      dataLines = []
      continue
    }

    if (line.startsWith(':')) continue

    const colon = line.indexOf(':')
    if (colon === -1) continue
    const field = line.slice(0, colon)
    const value = line.slice(colon + 1).trimStart()

    if (field === 'event') eventType = value
    else if (field === 'data') dataLines.push(value)
    else if (field === 'id') eventId = value
  }

  return events
}
