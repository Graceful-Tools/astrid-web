import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import React from 'react'

// We need to test the actual hooks, so let's unmock them from the global setup
vi.unmock('@/hooks/use-sse-subscription')

// Mock the SSE Manager - define inline to avoid hoisting issues
vi.mock('@/lib/sse-manager', () => ({
  SSEManager: {
    subscribe: vi.fn(() => vi.fn()), // Returns unsubscribe function
    onConnectionChange: vi.fn((callback) => {
      // Call immediately with current state
      callback(true)
      return vi.fn() // Return unsubscribe function
    }),
    onReconnection: vi.fn(() => vi.fn()), // Returns unsubscribe function
    getConnectionStatus: vi.fn(() => ({
      isConnected: true,
      isConnecting: false,
      connectionAttempts: 0,
      subscriptionCount: 1,
      lastEventTime: Date.now()
    }))
  }
}))

// Import hooks after mocking
import {
  useSSESubscription,
  useSSEConnectionStatus,
  useTaskSSEEvents,
  useAIAgentSSEEvents,
  useCodingWorkflowSSEEvents
} from '@/hooks/use-sse-subscription'

// Import the mocked SSEManager after mocking
import { SSEManager } from '@/lib/sse-manager'

describe('SSE Subscription Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Reset default mock behavior using the imported mocked instance
    vi.mocked(SSEManager.subscribe).mockImplementation(() => vi.fn())
    vi.mocked(SSEManager.onConnectionChange).mockImplementation((callback) => {
      callback(true)
      return vi.fn()
    })
    vi.mocked(SSEManager.getConnectionStatus).mockReturnValue({
      isConnected: true,
      isConnecting: false,
      connectionAttempts: 0,
      subscriptionCount: 1,
      lastEventTime: Date.now()
    })
  })

  describe('useSSESubscription', () => {
    it('should subscribe to SSE events on mount', () => {
      const callback = vi.fn()
      const eventTypes = ['test_event']

      renderHook(() =>
        useSSESubscription(eventTypes, callback, {
          componentName: 'TestComponent'
        })
      )

      expect(SSEManager.subscribe).toHaveBeenCalledWith(
        eventTypes,
        expect.any(Function),
        'TestComponent'
      )
    })

    it('should unsubscribe on unmount', () => {
      const callback = vi.fn()
      const unsubscribeMock = vi.fn()
      vi.mocked(SSEManager.subscribe).mockReturnValue(unsubscribeMock)

      const { unmount } = renderHook(() =>
        useSSESubscription(['test_event'], callback)
      )

      unmount()

      expect(unsubscribeMock).toHaveBeenCalled()
    })

    it('should handle disabled subscription', () => {
      const callback = vi.fn()

      renderHook(() =>
        useSSESubscription(['test_event'], callback, { enabled: false })
      )

      expect(SSEManager.subscribe).not.toHaveBeenCalled()
    })

    it('should re-subscribe when event types change', () => {
      const callback = vi.fn()
      const unsubscribeMock = vi.fn()
      vi.mocked(SSEManager.subscribe).mockReturnValue(unsubscribeMock)

      const { rerender } = renderHook(
        ({ eventTypes }) => useSSESubscription(eventTypes, callback),
        { initialProps: { eventTypes: ['event1'] } }
      )

      expect(SSEManager.subscribe).toHaveBeenCalledTimes(1)

      // Change event types
      rerender({ eventTypes: ['event1', 'event2'] })

      expect(unsubscribeMock).toHaveBeenCalled()
      expect(SSEManager.subscribe).toHaveBeenCalledTimes(2)
    })

    it('should not re-subscribe when callback changes', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      // Test the actual behavior - ensure the hook uses callback ref properly
      let capturedCallback: Function

      vi.mocked(SSEManager.subscribe).mockImplementation((eventTypes, cb) => {
        capturedCallback = cb
        return vi.fn()
      })

      const { rerender } = renderHook(
        ({ callback }) => useSSESubscription(['test_event'], callback),
        { initialProps: { callback: callback1 } }
      )

      // Simulate an event with the first callback
      const testEvent = { type: 'test_event', data: { test: 'first' } }
      act(() => {
        capturedCallback(testEvent)
      })

      expect(callback1).toHaveBeenCalledWith(testEvent)
      expect(callback2).not.toHaveBeenCalled()

      // Change callback and test that the new callback is used
      callback1.mockClear()
      rerender({ callback: callback2 })

      // Use the same captured callback (proving no re-subscription needed)
      act(() => {
        capturedCallback(testEvent)
      })

      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).toHaveBeenCalledWith(testEvent)
    })

    it('should call the current callback when event is received', () => {
      const callback = vi.fn()
      let capturedCallback: Function

      vi.mocked(SSEManager.subscribe).mockImplementation((eventTypes, cb) => {
        capturedCallback = cb
        return vi.fn()
      })

      renderHook(() => useSSESubscription(['test_event'], callback))

      const testEvent = {
        type: 'test_event',
        timestamp: new Date().toISOString(),
        data: { test: 'data' }
      }

      // Simulate event
      act(() => {
        capturedCallback(testEvent)
      })

      expect(callback).toHaveBeenCalledWith(testEvent)
    })

    it('should return connection status', () => {
      const callback = vi.fn()

      const { result } = renderHook(() =>
        useSSESubscription(['test_event'], callback)
      )

      expect(result.current.isConnected).toBe(true)
      expect(result.current.connectionStatus).toEqual(
        expect.objectContaining({
          isConnected: true,
          isConnecting: false,
          connectionAttempts: 0,
          subscriptionCount: 1
        })
      )
    })

    it('should handle string event type', () => {
      const callback = vi.fn()

      renderHook(() => useSSESubscription('single_event', callback))

      expect(SSEManager.subscribe).toHaveBeenCalledWith(
        'single_event',
        expect.any(Function),
        'UnknownComponent'
      )
    })

    it('should handle readonly array event types', () => {
      const callback = vi.fn()
      const eventTypes = ['event1', 'event2'] as const

      renderHook(() => useSSESubscription(eventTypes, callback))

      expect(SSEManager.subscribe).toHaveBeenCalledWith(
        eventTypes,
        expect.any(Function),
        'UnknownComponent'
      )
    })

    it('should subscribe to reconnection events when onReconnection is provided', () => {
      const callback = vi.fn()
      const onReconnection = vi.fn()

      renderHook(() =>
        useSSESubscription(['test_event'], callback, {
          onReconnection
        })
      )

      expect(SSEManager.onReconnection).toHaveBeenCalled()
    })

    it('should not subscribe to reconnection events when onReconnection is not provided', () => {
      const callback = vi.fn()
      vi.mocked(SSEManager.onReconnection).mockClear()

      renderHook(() =>
        useSSESubscription(['test_event'], callback)
      )

      // onReconnection should NOT be called when no callback is provided
      // The hook checks if onReconnectionRef.current exists before subscribing
      expect(SSEManager.onReconnection).not.toHaveBeenCalled()
    })

    it('should call onReconnection callback when SSE reconnects', () => {
      const callback = vi.fn()
      const onReconnection = vi.fn()
      let capturedReconnectionCallback: Function

      vi.mocked(SSEManager.onReconnection).mockImplementation((cb) => {
        capturedReconnectionCallback = cb
        return vi.fn()
      })

      renderHook(() =>
        useSSESubscription(['test_event'], callback, {
          onReconnection
        })
      )

      // Simulate reconnection event
      act(() => {
        capturedReconnectionCallback()
      })

      expect(onReconnection).toHaveBeenCalled()
    })

    it('should unsubscribe from reconnection events on unmount', () => {
      const callback = vi.fn()
      const onReconnection = vi.fn()
      const unsubscribeReconnection = vi.fn()

      vi.mocked(SSEManager.onReconnection).mockReturnValue(unsubscribeReconnection)

      const { unmount } = renderHook(() =>
        useSSESubscription(['test_event'], callback, {
          onReconnection
        })
      )

      unmount()

      expect(unsubscribeReconnection).toHaveBeenCalled()
    })

    it('should not subscribe to reconnection when disabled', () => {
      const callback = vi.fn()
      const onReconnection = vi.fn()
      vi.mocked(SSEManager.onReconnection).mockClear()

      renderHook(() =>
        useSSESubscription(['test_event'], callback, {
          enabled: false,
          onReconnection
        })
      )

      expect(SSEManager.onReconnection).not.toHaveBeenCalled()
    })
  })

  describe('useSSEConnectionStatus', () => {
    it('should provide connection status', () => {
      const { result } = renderHook(() => useSSEConnectionStatus())

      expect(result.current.isConnected).toBe(true)
      expect(result.current.connectionAttempts).toBe(0)
      expect(result.current.subscriptionCount).toBe(1)
      expect(typeof result.current.lastEventTime).toBe('number')
    })

    it('should subscribe to connection changes', () => {
      renderHook(() => useSSEConnectionStatus())

      expect(SSEManager.onConnectionChange).toHaveBeenCalled()
    })

    it('should update status periodically', async () => {
      vi.useFakeTimers()

      let statusUpdateCount = 0
      vi.mocked(SSEManager.getConnectionStatus).mockImplementation(() => {
        statusUpdateCount++
        return {
          isConnected: true,
          isConnecting: false,
          connectionAttempts: statusUpdateCount,
          subscriptionCount: 1,
          lastEventTime: Date.now()
        }
      })

      const { result } = renderHook(() => useSSEConnectionStatus())

      const initialAttempts = result.current.connectionAttempts

      // Fast-forward time to trigger interval
      act(() => {
        vi.advanceTimersByTime(5000)
      })

      // After advancing timers, the status should have updated
      expect(result.current.connectionAttempts).toBeGreaterThan(initialAttempts)

      vi.useRealTimers()
    })

    it('should cleanup interval on unmount', () => {
      vi.useFakeTimers()
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval')

      const { unmount } = renderHook(() => useSSEConnectionStatus())

      unmount()

      expect(clearIntervalSpy).toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  describe('useTaskSSEEvents', () => {
    it('should subscribe to task-related events', () => {
      const callbacks = {
        onTaskCreated: vi.fn(),
        onTaskUpdated: vi.fn(),
        onTaskDeleted: vi.fn(),
        onCommentCreated: vi.fn(),
        onCommentUpdated: vi.fn(),
        onCommentDeleted: vi.fn()
      }

      renderHook(() => useTaskSSEEvents(callbacks))

      expect(SSEManager.subscribe).toHaveBeenCalledWith(
        expect.arrayContaining([
          'task_created',
          'task_updated',
          'task_deleted',
          'comment_created',
          'comment_updated',
          'comment_deleted'
        ]),
        expect.any(Function),
        'TaskComponent'
      )
    })

    it('should handle task_created events', () => {
      const callbacks = { onTaskCreated: vi.fn() }
      let capturedCallback: Function

      vi.mocked(SSEManager.subscribe).mockImplementation((eventTypes, cb) => {
        capturedCallback = cb
        return vi.fn()
      })

      renderHook(() => useTaskSSEEvents(callbacks))

      const testEvent = {
        type: 'task_created',
        timestamp: new Date().toISOString(),
        data: { id: 'task-123', title: 'Test Task' }
      }

      act(() => {
        capturedCallback(testEvent)
      })

      expect(callbacks.onTaskCreated).toHaveBeenCalledWith(testEvent.data)
    })

    it('should handle task_updated events', () => {
      const callbacks = { onTaskUpdated: vi.fn() }
      let capturedCallback: Function

      vi.mocked(SSEManager.subscribe).mockImplementation((eventTypes, cb) => {
        capturedCallback = cb
        return vi.fn()
      })

      renderHook(() => useTaskSSEEvents(callbacks))

      const testEvent = {
        type: 'task_updated',
        timestamp: new Date().toISOString(),
        data: { id: 'task-123', title: 'Updated Task' }
      }

      act(() => {
        capturedCallback(testEvent)
      })

      expect(callbacks.onTaskUpdated).toHaveBeenCalledWith(testEvent.data)
    })

    it('should handle task_deleted events', () => {
      const callbacks = { onTaskDeleted: vi.fn() }
      let capturedCallback: Function

      vi.mocked(SSEManager.subscribe).mockImplementation((eventTypes, cb) => {
        capturedCallback = cb
        return vi.fn()
      })

      renderHook(() => useTaskSSEEvents(callbacks))

      const testEvent = {
        type: 'task_deleted',
        timestamp: new Date().toISOString(),
        data: { id: 'task-123' }
      }

      act(() => {
        capturedCallback(testEvent)
      })

      expect(callbacks.onTaskDeleted).toHaveBeenCalledWith('task-123')
    })

    it('should handle comment events', () => {
      const callbacks = {
        onCommentCreated: vi.fn(),
        onCommentUpdated: vi.fn(),
        onCommentDeleted: vi.fn()
      }
      let capturedCallback: Function

      vi.mocked(SSEManager.subscribe).mockImplementation((eventTypes, cb) => {
        capturedCallback = cb
        return vi.fn()
      })

      renderHook(() => useTaskSSEEvents(callbacks))

      // Test comment_created
      act(() => {
        capturedCallback({
          type: 'comment_created',
          data: { id: 'comment-123', content: 'Test comment' }
        })
      })
      expect(callbacks.onCommentCreated).toHaveBeenCalledWith(
        { id: 'comment-123', content: 'Test comment' }
      )

      // Test comment_updated
      act(() => {
        capturedCallback({
          type: 'comment_updated',
          data: { id: 'comment-123', content: 'Updated comment' }
        })
      })
      expect(callbacks.onCommentUpdated).toHaveBeenCalledWith(
        { id: 'comment-123', content: 'Updated comment' }
      )

      // Test comment_deleted
      act(() => {
        capturedCallback({
          type: 'comment_deleted',
          data: { id: 'comment-123' }
        })
      })
      expect(callbacks.onCommentDeleted).toHaveBeenCalledWith('comment-123')
    })

    it('should handle unknown events gracefully', () => {
      const callbacks = { onTaskCreated: vi.fn() }
      let capturedCallback: Function

      vi.mocked(SSEManager.subscribe).mockImplementation((eventTypes, cb) => {
        capturedCallback = cb
        return vi.fn()
      })

      renderHook(() => useTaskSSEEvents(callbacks))

      const unknownEvent = {
        type: 'unknown_event',
        timestamp: new Date().toISOString(),
        data: { test: 'data' }
      }

      // Should not throw
      act(() => {
        capturedCallback(unknownEvent)
      })

      expect(callbacks.onTaskCreated).not.toHaveBeenCalled()
    })

    it('should work with partial callback objects', () => {
      const callbacks = { onTaskCreated: vi.fn() } // Only one callback

      const { result } = renderHook(() => useTaskSSEEvents(callbacks))

      expect(result.current.isConnected).toBe(true)
    })

    it('should respect enabled option', () => {
      const callbacks = { onTaskCreated: vi.fn() }

      renderHook(() => useTaskSSEEvents(callbacks, { enabled: false }))

      expect(SSEManager.subscribe).not.toHaveBeenCalled()
    })

    it('should use custom component name', () => {
      const callbacks = { onTaskCreated: vi.fn() }

      renderHook(() => useTaskSSEEvents(callbacks, {
        componentName: 'CustomTaskComponent'
      }))

      expect(SSEManager.subscribe).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Function),
        'CustomTaskComponent'
      )
    })
  })

  describe('useAIAgentSSEEvents', () => {
    it('should subscribe to AI agent events', () => {
      const callbacks = {
        onAgentAssigned: vi.fn(),
        onAgentCommented: vi.fn(),
        onAgentTaskUpdated: vi.fn()
      }

      renderHook(() => useAIAgentSSEEvents(callbacks))

      expect(SSEManager.subscribe).toHaveBeenCalledWith(
        expect.arrayContaining([
          'ai_agent_assigned',
          'ai_agent_commented',
          'ai_agent_task_updated'
        ]),
        expect.any(Function),
        'AIAgentComponent'
      )
    })

    it('should handle AI agent events correctly', () => {
      const callbacks = {
        onAgentAssigned: vi.fn(),
        onAgentCommented: vi.fn(),
        onAgentTaskUpdated: vi.fn()
      }
      let capturedCallback: Function

      vi.mocked(SSEManager.subscribe).mockImplementation((eventTypes, cb) => {
        capturedCallback = cb
        return vi.fn()
      })

      renderHook(() => useAIAgentSSEEvents(callbacks))

      // Test each event type
      act(() => {
        capturedCallback({
          type: 'ai_agent_assigned',
          data: { agentId: 'agent-123', taskId: 'task-456' }
        })
      })
      expect(callbacks.onAgentAssigned).toHaveBeenCalledWith(
        { agentId: 'agent-123', taskId: 'task-456' }
      )

      act(() => {
        capturedCallback({
          type: 'ai_agent_commented',
          data: { comment: 'AI comment', taskId: 'task-456' }
        })
      })
      expect(callbacks.onAgentCommented).toHaveBeenCalledWith(
        { comment: 'AI comment', taskId: 'task-456' }
      )

      act(() => {
        capturedCallback({
          type: 'ai_agent_task_updated',
          data: { taskId: 'task-456', status: 'completed' }
        })
      })
      expect(callbacks.onAgentTaskUpdated).toHaveBeenCalledWith(
        { taskId: 'task-456', status: 'completed' }
      )
    })
  })

  describe('useCodingWorkflowSSEEvents', () => {
    it('should subscribe to coding workflow events', () => {
      const callbacks = {
        onTaskAssigned: vi.fn(),
        onPlanApproved: vi.fn(),
        onMergeRequested: vi.fn(),
        onTaskCompleted: vi.fn(),
        onTaskFailed: vi.fn()
      }

      renderHook(() => useCodingWorkflowSSEEvents(callbacks))

      expect(SSEManager.subscribe).toHaveBeenCalledWith(
        expect.arrayContaining([
          'coding_task_assigned',
          'coding_plan_approved',
          'coding_merge_requested',
          'coding_task_completed',
          'coding_task_failed'
        ]),
        expect.any(Function),
        'CodingWorkflowComponent'
      )
    })

    it('should handle coding workflow events correctly', () => {
      const callbacks = {
        onTaskAssigned: vi.fn(),
        onPlanApproved: vi.fn(),
        onMergeRequested: vi.fn(),
        onTaskCompleted: vi.fn(),
        onTaskFailed: vi.fn()
      }
      let capturedCallback: Function

      vi.mocked(SSEManager.subscribe).mockImplementation((eventTypes, cb) => {
        capturedCallback = cb
        return vi.fn()
      })

      renderHook(() => useCodingWorkflowSSEEvents(callbacks))

      // Test each event type
      const testCases = [
        { type: 'coding_task_assigned', callback: 'onTaskAssigned' },
        { type: 'coding_plan_approved', callback: 'onPlanApproved' },
        { type: 'coding_merge_requested', callback: 'onMergeRequested' },
        { type: 'coding_task_completed', callback: 'onTaskCompleted' },
        { type: 'coding_task_failed', callback: 'onTaskFailed' }
      ]

      testCases.forEach(({ type, callback }) => {
        const testData = { taskId: 'task-123', workflow: 'test' }

        act(() => {
          capturedCallback({
            type,
            data: testData
          })
        })

        expect(callbacks[callback as keyof typeof callbacks]).toHaveBeenCalledWith(testData)
      })
    })
  })

  describe('Hook Integration', () => {
    it('should handle connection state changes across all hooks', () => {
      const connectionCallbacks: Function[] = []

      vi.mocked(SSEManager.onConnectionChange).mockImplementation((callback) => {
        connectionCallbacks.push(callback)
        callback(false) // Start disconnected
        return vi.fn()
      })

      const { result: result1 } = renderHook(() => useSSESubscription(['test'], vi.fn()))
      const { result: result2 } = renderHook(() => useSSEConnectionStatus())

      expect(result1.current.isConnected).toBe(false)
      expect(result2.current.isConnected).toBe(false)

      // Simulate connection - call all registered callbacks
      act(() => {
        connectionCallbacks.forEach(callback => callback(true))
      })

      expect(result1.current.isConnected).toBe(true)
      expect(result2.current.isConnected).toBe(true)
    })

    it('should maintain stable callbacks across re-renders', () => {
      const { rerender } = renderHook(
        ({ count }) => {
          const callback = vi.fn(() => count)
          return useTaskSSEEvents({ onTaskCreated: callback })
        },
        { initialProps: { count: 1 } }
      )

      expect(SSEManager.subscribe).toHaveBeenCalledTimes(1)

      rerender({ count: 2 })

      // Should not re-subscribe due to callback change
      expect(SSEManager.subscribe).toHaveBeenCalledTimes(1)
    })
  })
})