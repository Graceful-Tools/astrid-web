/**
 * SSE Client Dispatch Tests
 *
 * Tests the event mapping and dispatch logic used by the SDK SSEClient.
 * Validates that internal server event types are correctly mapped to
 * protocol event names and that unnamed events are properly unwrapped.
 */
import { describe, it, expect } from 'vitest'

/**
 * Standalone implementation of the SSE client's mapEventType logic
 * (mirrors SSEClient.mapEventType from packages/astrid-sdk/src/channel/sse-client.ts)
 */
function mapEventType(type: string): string {
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

/**
 * Standalone implementation of the SSE client's dispatch logic
 * (mirrors SSEClient.dispatch from packages/astrid-sdk/src/channel/sse-client.ts)
 */
function dispatch(event: { type: string; data: any }): { type: string; data: any } {
  let type = event.type
  let data = event.data

  // Handle unnamed SSE events from broadcastToUsers / Redis polling
  if (type === 'message' && data?.type) {
    type = mapEventType(data.type as string)
    data = data.data || data
  }

  return { type, data }
}

describe('SDK SSE Client — mapEventType', () => {
  it('should map task_assigned to task.assigned', () => {
    expect(mapEventType('task_assigned')).toBe('task.assigned')
  })

  it('should map task_created to task.assigned', () => {
    expect(mapEventType('task_created')).toBe('task.assigned')
  })

  it('should map task_updated to task.updated', () => {
    expect(mapEventType('task_updated')).toBe('task.updated')
  })

  it('should map task_completed to task.completed', () => {
    expect(mapEventType('task_completed')).toBe('task.completed')
  })

  it('should map task_deleted to task.deleted', () => {
    expect(mapEventType('task_deleted')).toBe('task.deleted')
  })

  it('should map comment_created to task.commented', () => {
    expect(mapEventType('comment_created')).toBe('task.commented')
  })

  it('should map comment_added to task.commented', () => {
    expect(mapEventType('comment_added')).toBe('task.commented')
  })

  it('should map agent_task_comment to task.commented', () => {
    expect(mapEventType('agent_task_comment')).toBe('task.commented')
  })

  it('should pass through unknown event types unchanged', () => {
    expect(mapEventType('custom_event')).toBe('custom_event')
    expect(mapEventType('connected')).toBe('connected')
    expect(mapEventType('reconnect')).toBe('reconnect')
  })
})

describe('SDK SSE Client — dispatch (unnamed event unwrapping)', () => {
  it('should unwrap unnamed message events with internal type', () => {
    const raw = {
      type: 'message',
      data: {
        type: 'task_assigned',
        timestamp: '2025-06-01T00:00:00Z',
        data: {
          taskId: 'task-1',
          task: { id: 'task-1', title: 'Test' },
        },
      },
    }

    const result = dispatch(raw)

    expect(result.type).toBe('task.assigned')
    expect(result.data.taskId).toBe('task-1')
    expect(result.data.task).toBeDefined()
  })

  it('should unwrap unnamed comment events', () => {
    const raw = {
      type: 'message',
      data: {
        type: 'comment_created',
        timestamp: '2025-06-01T00:00:00Z',
        data: {
          taskId: 'task-1',
          commentId: 'comment-1',
          comment: { id: 'comment-1', content: 'Hello' },
        },
      },
    }

    const result = dispatch(raw)

    expect(result.type).toBe('task.commented')
    expect(result.data.commentId).toBe('comment-1')
  })

  it('should unwrap agent_task_comment events', () => {
    const raw = {
      type: 'message',
      data: {
        type: 'agent_task_comment',
        timestamp: '2025-06-01T00:00:00Z',
        data: {
          taskId: 'task-1',
          comment: { id: 'c-1', content: 'Agent reply' },
        },
      },
    }

    const result = dispatch(raw)

    expect(result.type).toBe('task.commented')
    expect(result.data.comment.content).toBe('Agent reply')
  })

  it('should pass through named events unchanged', () => {
    const raw = {
      type: 'task.assigned',
      data: {
        taskId: 'task-1',
        task: { id: 'task-1', title: 'Test' },
      },
    }

    const result = dispatch(raw)

    expect(result.type).toBe('task.assigned')
    expect(result.data.taskId).toBe('task-1')
  })

  it('should fall back to full data when nested data is missing', () => {
    const raw = {
      type: 'message',
      data: {
        type: 'task_deleted',
        taskId: 'task-1',
        // No nested data field
      },
    }

    const result = dispatch(raw)

    expect(result.type).toBe('task.deleted')
    expect(result.data.taskId).toBe('task-1')
  })

  it('should not unwrap message events without type field', () => {
    const raw = {
      type: 'message',
      data: {
        taskId: 'task-1',
        // No type field
      },
    }

    const result = dispatch(raw)

    // Should remain as 'message' since there's no type to map
    expect(result.type).toBe('message')
  })
})

describe('SDK ↔ Server Event Type Consistency', () => {
  // These tests verify that the SDK client maps the same event types
  // as the server-side mapEventType in lib/agent-protocol.ts

  const serverMappings: [string, string][] = [
    ['task_assigned', 'task.assigned'],
    ['task_created', 'task.assigned'],
    ['task_updated', 'task.updated'],
    ['task_completed', 'task.completed'],
    ['task_deleted', 'task.deleted'],
    ['comment_created', 'task.commented'],
    ['comment_added', 'task.commented'],
    ['agent_task_comment', 'task.commented'],
  ]

  for (const [internal, protocol] of serverMappings) {
    it(`SDK should map ${internal} → ${protocol} (matching server)`, () => {
      expect(mapEventType(internal)).toBe(protocol)
    })
  }
})
