/**
 * Channel Adapter Session-Aware Dedup Tests
 *
 * Tests that the Astrid channel adapter's task.assigned handler
 * skips duplicate dispatches when a session already exists.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SessionMapper } from '../../packages/astrid-sdk/src/channel/session-mapper'

// ── Mock types ────────────────────────────────────────────────────────

interface MockEvent {
  type: string
  data: {
    taskId: string
    task?: { id: string; title: string }
    comment?: { id: string; content: string }
  }
}

// ── Simulate the channel adapter's task.assigned handler logic ────────
// Extracted from packages/astrid-sdk/src/channel/channel.ts

function createMockAdapter() {
  const sessions = new SessionMapper()
  const onMessage = vi.fn()
  const dispatched: string[] = []

  const handleTaskAssigned = (event: MockEvent) => {
    if (!event.data.task) return
    const taskId = event.data.taskId
    if (sessions.get(taskId)) return // Already has active session — skip duplicate
    sessions.getOrCreate(taskId)
    onMessage({ content: event.data.task.title, sessionKey: `astrid:task:${taskId}` })
    dispatched.push(taskId)
  }

  const handleTaskCompleted = (event: MockEvent) => {
    sessions.end(event.data.taskId)
  }

  const handleTaskDeleted = (event: MockEvent) => {
    sessions.end(event.data.taskId)
  }

  const handleTaskCommented = (event: MockEvent) => {
    const sessionKey = sessions.get(event.data.taskId)
    if (!sessionKey || !event.data.comment) return
    onMessage({
      content: event.data.comment.content,
      sessionKey,
    })
  }

  return {
    sessions,
    onMessage,
    dispatched,
    handleTaskAssigned,
    handleTaskCompleted,
    handleTaskDeleted,
    handleTaskCommented,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Channel Adapter — Session-Aware Dedup', () => {
  let adapter: ReturnType<typeof createMockAdapter>

  beforeEach(() => {
    adapter = createMockAdapter()
  })

  it('should dispatch onMessage on first task.assigned', () => {
    adapter.handleTaskAssigned({
      type: 'task.assigned',
      data: {
        taskId: 'task-1',
        task: { id: 'task-1', title: 'Fix bug' },
      },
    })

    expect(adapter.onMessage).toHaveBeenCalledTimes(1)
    expect(adapter.onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Fix bug',
        sessionKey: 'astrid:task:task-1',
      })
    )
  })

  it('should NOT dispatch onMessage on second task.assigned for same taskId', () => {
    // First assignment
    adapter.handleTaskAssigned({
      type: 'task.assigned',
      data: {
        taskId: 'task-1',
        task: { id: 'task-1', title: 'Fix bug' },
      },
    })

    // Second assignment (duplicate)
    adapter.handleTaskAssigned({
      type: 'task.assigned',
      data: {
        taskId: 'task-1',
        task: { id: 'task-1', title: 'Fix bug' },
      },
    })

    expect(adapter.onMessage).toHaveBeenCalledTimes(1)
  })

  it('should dispatch onMessage for different taskIds', () => {
    adapter.handleTaskAssigned({
      type: 'task.assigned',
      data: {
        taskId: 'task-1',
        task: { id: 'task-1', title: 'Fix bug' },
      },
    })

    adapter.handleTaskAssigned({
      type: 'task.assigned',
      data: {
        taskId: 'task-2',
        task: { id: 'task-2', title: 'Add feature' },
      },
    })

    expect(adapter.onMessage).toHaveBeenCalledTimes(2)
  })

  it('should dispatch onMessage again after task.completed ends session', () => {
    // First assignment
    adapter.handleTaskAssigned({
      type: 'task.assigned',
      data: {
        taskId: 'task-1',
        task: { id: 'task-1', title: 'Fix bug' },
      },
    })

    // Task completed — session ends
    adapter.handleTaskCompleted({
      type: 'task.completed',
      data: { taskId: 'task-1' },
    })

    // Re-assignment of same task — should dispatch again
    adapter.handleTaskAssigned({
      type: 'task.assigned',
      data: {
        taskId: 'task-1',
        task: { id: 'task-1', title: 'Fix bug (reopened)' },
      },
    })

    expect(adapter.onMessage).toHaveBeenCalledTimes(2)
  })

  it('should dispatch onMessage again after task.deleted ends session', () => {
    adapter.handleTaskAssigned({
      type: 'task.assigned',
      data: {
        taskId: 'task-1',
        task: { id: 'task-1', title: 'Fix bug' },
      },
    })

    adapter.handleTaskDeleted({
      type: 'task.deleted',
      data: { taskId: 'task-1' },
    })

    adapter.handleTaskAssigned({
      type: 'task.assigned',
      data: {
        taskId: 'task-1',
        task: { id: 'task-1', title: 'Fix bug (recreated)' },
      },
    })

    expect(adapter.onMessage).toHaveBeenCalledTimes(2)
  })

  it('should skip task.assigned when task data is missing', () => {
    adapter.handleTaskAssigned({
      type: 'task.assigned',
      data: {
        taskId: 'task-1',
        // no task object
      },
    })

    expect(adapter.onMessage).not.toHaveBeenCalled()
  })

  it('should skip task.commented when no session exists', () => {
    // Comment for a task we never received task.assigned for
    adapter.handleTaskCommented({
      type: 'task.commented',
      data: {
        taskId: 'task-unknown',
        comment: { id: 'c-1', content: 'hello' },
      },
    })

    expect(adapter.onMessage).not.toHaveBeenCalled()
  })

  it('should deliver task.commented when session exists', () => {
    // Create session first
    adapter.handleTaskAssigned({
      type: 'task.assigned',
      data: {
        taskId: 'task-1',
        task: { id: 'task-1', title: 'Fix bug' },
      },
    })

    // Comment should be dispatched
    adapter.handleTaskCommented({
      type: 'task.commented',
      data: {
        taskId: 'task-1',
        comment: { id: 'c-1', content: 'Working on it' },
      },
    })

    expect(adapter.onMessage).toHaveBeenCalledTimes(2) // assigned + comment
  })
})
