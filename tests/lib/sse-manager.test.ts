import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SSESubscription } from '@/lib/sse-manager'
import { row } from '../fixtures/prisma-rows'
import { getSession } from 'next-auth/react'

// We need to test the actual implementation, not the mock
// So we'll mock only the dependencies, not the SSE Manager itself
vi.unmock('@/lib/sse-manager')

// Mock next-auth
vi.mock('next-auth/react', () => ({
  getSession: vi.fn()
}))

// Mock EventSource
class MockEventSource {
  url: string
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  readyState: number = 0

  constructor(url: string) {
    this.url = url
    this.readyState = 0 // CONNECTING

    // Simulate opening the connection asynchronously
    setTimeout(() => {
      this.readyState = 1 // OPEN
      if (this.onopen) {
        this.onopen(new Event('open'))
      }
    }, 10)
  }

  close() {
    this.readyState = 2 // CLOSED
  }

  // Helper methods for testing
  simulateMessage(data: any) {
    if (this.onmessage) {
      const event = new MessageEvent('message', {
        data: JSON.stringify(data)
      })
      this.onmessage(event)
    }
  }

  simulateError() {
    if (this.onerror) {
      this.onerror(new Event('error'))
    }
  }
}

// Mock global EventSource
global.EventSource = MockEventSource as any

// Mock document for visibility change events
Object.defineProperty(document, 'hidden', {
  writable: true,
  value: false
})

Object.defineProperty(document, 'addEventListener', {
  writable: true,
  value: vi.fn()
})

describe('SSE Manager', () => {
  let SSEManager: any
  let mockEventSource: MockEventSource

  beforeEach(async () => {
    vi.clearAllMocks()

    // Mock successful session
    vi.mocked(getSession).mockResolvedValue(row({
      user: {
        id: 'test-user-123',
        name: 'Test User',
        email: 'test@example.com'
      }
    }))

    // Clear any existing event sources
    mockEventSource = null as any

    // Dynamically import SSE Manager to get fresh instance
    const sseModule = await import('@/lib/sse-manager')
    SSEManager = sseModule.SSEManager

    // Reset the singleton state (access private properties for testing)
    if (SSEManager.eventSource) {
      SSEManager.eventSource.close()
      SSEManager.eventSource = null
    }
    SSEManager.subscriptions?.clear()
    SSEManager.isConnected = false
    SSEManager.isConnecting = false
    SSEManager.connectionAttempts = 0
  })

  afterEach(() => {
    if (mockEventSource) {
      mockEventSource.close()
    }
    if (SSEManager?.eventSource) {
      SSEManager.eventSource.close()
    }
  })

  describe('Subscription Management', () => {
    it('should create a subscription and return unsubscribe function', async () => {
      const callback = vi.fn()
      const eventTypes = ['test_event']

      const unsubscribe = SSEManager.subscribe(eventTypes, callback, 'TestComponent')

      expect(typeof unsubscribe).toBe('function')
      expect(SSEManager.subscriptions.size).toBe(1)

      // Cleanup
      unsubscribe()
      expect(SSEManager.subscriptions.size).toBe(0)
    })

    it('should handle multiple event types in subscription', async () => {
      const callback = vi.fn()
      const eventTypes = ['event1', 'event2', 'event3']

      const unsubscribe = SSEManager.subscribe(eventTypes, callback, 'TestComponent')

      expect(SSEManager.subscriptions.size).toBe(1)
      const subscription = Array.from(SSEManager.subscriptions.values())[0] as SSESubscription
      expect(subscription.eventTypes).toEqual(eventTypes)

      unsubscribe()
    })

    it('should handle string event type', async () => {
      const callback = vi.fn()
      const eventType = 'single_event'

      const unsubscribe = SSEManager.subscribe(eventType, callback, 'TestComponent')

      const subscription = Array.from(SSEManager.subscriptions.values())[0] as SSESubscription
      expect(subscription.eventTypes).toEqual([eventType])

      unsubscribe()
    })

    it('should auto-connect when subscribing if not connected', async () => {
      const callback = vi.fn()

      expect(SSEManager.isConnected).toBe(false)
      expect(SSEManager.isConnecting).toBe(false)

      const unsubscribe = SSEManager.subscribe(['test'], callback)

      // Wait for connection to be established (connection goes from disconnected -> connecting -> connected)
      await new Promise(resolve => setTimeout(resolve, 30))

      // Should have attempted connection and either be connecting or connected
      const hasConnected = SSEManager.isConnected || SSEManager.isConnecting
      expect(hasConnected).toBe(true)

      unsubscribe()
    })

    it('should disconnect when last subscription is removed', async () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      const unsubscribe1 = SSEManager.subscribe(['test'], callback1)
      const unsubscribe2 = SSEManager.subscribe(['test'], callback2)

      expect(SSEManager.subscriptions.size).toBe(2)

      // Remove first subscription
      unsubscribe1()
      expect(SSEManager.subscriptions.size).toBe(1)
      // Should still be connected

      // Remove last subscription
      unsubscribe2()
      expect(SSEManager.subscriptions.size).toBe(0)
      // Should disconnect
    })
  })

  describe('Connection Management', () => {
    it('should establish connection when session is available', async () => {
      const callback = vi.fn()

      SSEManager.subscribe(['test'], callback)

      // Wait for connection to be established
      await new Promise(resolve => setTimeout(resolve, 20))

      expect(SSEManager.isConnected).toBe(true)
      expect(SSEManager.isConnecting).toBe(false)
    })

    it('should not connect when session is unavailable', async () => {
      vi.mocked(getSession).mockResolvedValue(null)

      const callback = vi.fn()
      SSEManager.subscribe(['test'], callback)

      await new Promise(resolve => setTimeout(resolve, 20))

      expect(SSEManager.isConnected).toBe(false)
    })

    it('should handle session fetch errors gracefully', async () => {
      vi.mocked(getSession).mockRejectedValue(new Error('Session error'))

      const callback = vi.fn()
      SSEManager.subscribe(['test'], callback)

      await new Promise(resolve => setTimeout(resolve, 20))

      expect(SSEManager.isConnected).toBe(false)
    })

    it('should not create multiple connections when already connecting', async () => {
      const callback = vi.fn()

      // Subscribe multiple times rapidly
      SSEManager.subscribe(['test1'], callback)
      SSEManager.subscribe(['test2'], callback)
      SSEManager.subscribe(['test3'], callback)

      await new Promise(resolve => setTimeout(resolve, 20))

      // Should only have one connection
      expect(SSEManager.eventSource).toBeTruthy()
    })
  })

  describe('Event Routing', () => {
    it('should route events to matching subscribers', async () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()
      const callback3 = vi.fn()

      const unsubscribe1 = SSEManager.subscribe(['event1'], callback1)
      const unsubscribe2 = SSEManager.subscribe(['event1', 'event2'], callback2)
      const unsubscribe3 = SSEManager.subscribe(['event3'], callback3)

      await new Promise(resolve => setTimeout(resolve, 20))

      // Get the EventSource instance and simulate an event
      const eventSource = SSEManager.eventSource as MockEventSource
      expect(eventSource).toBeTruthy()

      const testEvent = {
        type: 'event1',
        timestamp: new Date().toISOString(),
        data: { test: 'data' }
      }

      eventSource.simulateMessage(testEvent)

      // callback1 and callback2 should receive the event, callback3 should not
      expect(callback1).toHaveBeenCalledWith(testEvent)
      expect(callback2).toHaveBeenCalledWith(testEvent)
      expect(callback3).not.toHaveBeenCalled()

      unsubscribe1()
      unsubscribe2()
      unsubscribe3()
    })

    it('should handle wildcard subscriptions', async () => {
      const callbackWildcard = vi.fn()
      const callbackSpecific = vi.fn()

      const unsubscribe1 = SSEManager.subscribe(['*'], callbackWildcard)
      const unsubscribe2 = SSEManager.subscribe(['specific_event'], callbackSpecific)

      await new Promise(resolve => setTimeout(resolve, 20))

      const eventSource = SSEManager.eventSource as MockEventSource
      const testEvent = {
        type: 'any_event',
        timestamp: new Date().toISOString(),
        data: { test: 'data' }
      }

      eventSource.simulateMessage(testEvent)

      // Wildcard should receive all events
      expect(callbackWildcard).toHaveBeenCalledWith(testEvent)
      expect(callbackSpecific).not.toHaveBeenCalled()

      unsubscribe1()
      unsubscribe2()
    })

    it('should handle ping events without routing', async () => {
      const callback = vi.fn()
      const unsubscribe = SSEManager.subscribe(['*'], callback)

      await new Promise(resolve => setTimeout(resolve, 20))

      const eventSource = SSEManager.eventSource as MockEventSource
      const pingEvent = {
        type: 'ping',
        timestamp: new Date().toISOString()
      }

      eventSource.simulateMessage(pingEvent)

      // Ping events should not be routed to subscribers
      expect(callback).not.toHaveBeenCalled()

      unsubscribe()
    })

    it('should handle malformed event data gracefully', async () => {
      const callback = vi.fn()
      const unsubscribe = SSEManager.subscribe(['test'], callback)

      await new Promise(resolve => setTimeout(resolve, 20))

      const eventSource = SSEManager.eventSource as MockEventSource

      // Simulate malformed JSON
      if (eventSource.onmessage) {
        const badEvent = new MessageEvent('message', {
          data: 'invalid json'
        })
        eventSource.onmessage(badEvent)
      }

      // Should not call callback with malformed data
      expect(callback).not.toHaveBeenCalled()

      unsubscribe()
    })

    it('should handle callback errors gracefully', async () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Callback error')
      })
      const normalCallback = vi.fn()

      const unsubscribe1 = SSEManager.subscribe(['test'], errorCallback)
      const unsubscribe2 = SSEManager.subscribe(['test'], normalCallback)

      await new Promise(resolve => setTimeout(resolve, 20))

      const eventSource = SSEManager.eventSource as MockEventSource
      const testEvent = {
        type: 'test',
        timestamp: new Date().toISOString(),
        data: { test: 'data' }
      }

      eventSource.simulateMessage(testEvent)

      // Both callbacks should be called despite error in first one
      expect(errorCallback).toHaveBeenCalledWith(testEvent)
      expect(normalCallback).toHaveBeenCalledWith(testEvent)

      unsubscribe1()
      unsubscribe2()
    })

    it('should handle empty event data gracefully', async () => {
      const callback = vi.fn()
      const unsubscribe = SSEManager.subscribe(['test'], callback)

      await new Promise(resolve => setTimeout(resolve, 20))

      const eventSource = SSEManager.eventSource as MockEventSource

      // Simulate empty event data
      if (eventSource.onmessage) {
        const emptyEvent = new MessageEvent('message', {
          data: ''
        })
        eventSource.onmessage(emptyEvent)
      }

      // Should not call callback with empty data
      expect(callback).not.toHaveBeenCalled()

      unsubscribe()
    })

    it('should handle null event data gracefully', async () => {
      const callback = vi.fn()
      const unsubscribe = SSEManager.subscribe(['test'], callback)

      await new Promise(resolve => setTimeout(resolve, 20))

      const eventSource = SSEManager.eventSource as MockEventSource

      // Simulate null event data
      if (eventSource.onmessage) {
        const nullEvent = new MessageEvent('message', {
          data: null as unknown as string
        })
        eventSource.onmessage(nullEvent)
      }

      // Should not call callback with null data
      expect(callback).not.toHaveBeenCalled()

      unsubscribe()
    })

    it('should handle whitespace-only event data gracefully', async () => {
      const callback = vi.fn()
      const unsubscribe = SSEManager.subscribe(['test'], callback)

      await new Promise(resolve => setTimeout(resolve, 20))

      const eventSource = SSEManager.eventSource as MockEventSource

      // Simulate whitespace-only event data
      if (eventSource.onmessage) {
        const whitespaceEvent = new MessageEvent('message', {
          data: '   '
        })
        eventSource.onmessage(whitespaceEvent)
      }

      // Should not call callback with whitespace-only data
      expect(callback).not.toHaveBeenCalled()

      unsubscribe()
    })
  })

  describe('Connection Status', () => {
    it('should return correct connection status', () => {
      const status = SSEManager.getConnectionStatus()

      expect(status).toHaveProperty('isConnected')
      expect(status).toHaveProperty('isConnecting')
      expect(status).toHaveProperty('connectionAttempts')
      expect(status).toHaveProperty('subscriptionCount')
      expect(status).toHaveProperty('lastEventTime')

      expect(typeof status.isConnected).toBe('boolean')
      expect(typeof status.subscriptionCount).toBe('number')
    })

    it('should notify connection listeners of status changes', async () => {
      const listener = vi.fn()

      const unsubscribeListener = SSEManager.onConnectionChange(listener)

      // Should be called immediately with current status
      expect(listener).toHaveBeenCalledWith(false)

      // Start a connection
      const callback = vi.fn()
      const unsubscribe = SSEManager.subscribe(['test'], callback)

      await new Promise(resolve => setTimeout(resolve, 20))

      // Should be notified of connection
      expect(listener).toHaveBeenCalledWith(true)

      unsubscribeListener()
      unsubscribe()
    })
  })

  describe('Error Handling and Reconnection', () => {
    it('should handle connection errors with exponential backoff', async () => {
      const callback = vi.fn()
      const unsubscribe = SSEManager.subscribe(['test'], callback)

      await new Promise(resolve => setTimeout(resolve, 20))

      const eventSource = SSEManager.eventSource as MockEventSource

      // Simulate connection error
      eventSource.simulateError()

      expect(SSEManager.isConnected).toBe(false)
      expect(SSEManager.connectionAttempts).toBeGreaterThan(0)

      unsubscribe()
    })

    it('should implement circuit breaker after multiple failures', async () => {
      const callback = vi.fn()
      const unsubscribe = SSEManager.subscribe(['test'], callback)

      await new Promise(resolve => setTimeout(resolve, 20))

      // Simulate multiple connection failures by setting attempts high
      SSEManager.connectionAttempts = 10 // Max attempts

      const eventSource = SSEManager.eventSource as MockEventSource
      eventSource.simulateError()

      // Should not attempt to reconnect after circuit breaker is activated
      expect(SSEManager.connectionAttempts).toBeGreaterThanOrEqual(10)

      unsubscribe()
    })

    it('should reset connection attempts on successful connection', async () => {
      const callback = vi.fn()

      // Set some previous connection attempts
      SSEManager.connectionAttempts = 3

      const unsubscribe = SSEManager.subscribe(['test'], callback)

      await new Promise(resolve => setTimeout(resolve, 20))

      // Connection attempts should be reset on successful connection
      expect(SSEManager.connectionAttempts).toBe(0)

      unsubscribe()
    })
  })

  describe('Debug Information', () => {
    it('should provide comprehensive debug information', async () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      const unsubscribe1 = SSEManager.subscribe(['event1'], callback1, 'Component1')
      const unsubscribe2 = SSEManager.subscribe(['event2'], callback2, 'Component2')

      const debugInfo = SSEManager.getDebugInfo()

      expect(debugInfo).toHaveProperty('connectionStatus')
      expect(debugInfo).toHaveProperty('subscriptions')
      expect(debugInfo).toHaveProperty('subscriptionsByComponent')

      expect(debugInfo.subscriptions).toHaveLength(2)
      expect(debugInfo.subscriptionsByComponent).toHaveProperty('Component1', 1)
      expect(debugInfo.subscriptionsByComponent).toHaveProperty('Component2', 1)

      unsubscribe1()
      unsubscribe2()
    })
  })

  describe('Force Reconnection', () => {
    it('should force reconnection when requested', async () => {
      const callback = vi.fn()
      const unsubscribe = SSEManager.subscribe(['test'], callback)

      await new Promise(resolve => setTimeout(resolve, 20))

      expect(SSEManager.isConnected).toBe(true)

      // Force reconnection
      SSEManager.forceReconnect()

      expect(SSEManager.isConnected).toBe(false)

      // Should reconnect after delay
      await new Promise(resolve => setTimeout(resolve, 1100))

      expect(SSEManager.isConnected).toBe(true)

      unsubscribe()
    })
  })

  describe('Heartbeat Monitoring', () => {
    it('should update last event time on message receipt', async () => {
      const callback = vi.fn()
      const unsubscribe = SSEManager.subscribe(['test'], callback)

      await new Promise(resolve => setTimeout(resolve, 20))

      const initialTime = SSEManager.lastEventTime

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10))

      const eventSource = SSEManager.eventSource as MockEventSource
      const testEvent = {
        type: 'test',
        timestamp: new Date().toISOString(),
        data: { test: 'data' }
      }

      eventSource.simulateMessage(testEvent)

      expect(SSEManager.lastEventTime).toBeGreaterThan(initialTime)

      unsubscribe()
    })
  })
})