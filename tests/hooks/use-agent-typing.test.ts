import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAgentTyping } from '@/hooks/use-agent-typing'

describe('useAgentTyping', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should start with not typing', () => {
    const { result } = renderHook(() => useAgentTyping('channel-1'))
    expect(result.current).toEqual({ isTyping: false, agentName: null, agentId: null })
  })

  it('should return not typing when channelId is null', () => {
    const { result } = renderHook(() => useAgentTyping(null))
    expect(result.current.isTyping).toBe(false)
  })

  it('should set typing on agent_typing_start event', () => {
    const { result } = renderHook(() => useAgentTyping('channel-1'))

    act(() => {
      window.dispatchEvent(new CustomEvent('agent_typing_start', {
        detail: { channelId: 'channel-1', agentId: 'agent-1', agentName: 'Astrid' }
      }))
    })

    expect(result.current).toEqual({ isTyping: true, agentName: 'Astrid', agentId: 'agent-1' })
  })

  it('should ignore events for other channels', () => {
    const { result } = renderHook(() => useAgentTyping('channel-1'))

    act(() => {
      window.dispatchEvent(new CustomEvent('agent_typing_start', {
        detail: { channelId: 'channel-OTHER', agentId: 'agent-1', agentName: 'Astrid' }
      }))
    })

    expect(result.current.isTyping).toBe(false)
  })

  it('should clear typing on agent_typing_stop event', () => {
    const { result } = renderHook(() => useAgentTyping('channel-1'))

    act(() => {
      window.dispatchEvent(new CustomEvent('agent_typing_start', {
        detail: { channelId: 'channel-1', agentId: 'agent-1', agentName: 'Astrid' }
      }))
    })
    expect(result.current.isTyping).toBe(true)

    act(() => {
      window.dispatchEvent(new CustomEvent('agent_typing_stop', {
        detail: { channelId: 'channel-1', agentId: 'agent-1' }
      }))
    })
    expect(result.current).toEqual({ isTyping: false, agentName: null, agentId: null })
  })

  it('should clear typing on chat_message_created from AI agent', () => {
    const { result } = renderHook(() => useAgentTyping('channel-1'))

    act(() => {
      window.dispatchEvent(new CustomEvent('agent_typing_start', {
        detail: { channelId: 'channel-1', agentId: 'agent-1', agentName: 'Astrid' }
      }))
    })
    expect(result.current.isTyping).toBe(true)

    act(() => {
      window.dispatchEvent(new CustomEvent('chat_message_created', {
        detail: { channelId: 'channel-1', message: { author: { isAIAgent: true } } }
      }))
    })
    expect(result.current.isTyping).toBe(false)
  })

  it('should NOT clear typing on chat_message_created from human', () => {
    const { result } = renderHook(() => useAgentTyping('channel-1'))

    act(() => {
      window.dispatchEvent(new CustomEvent('agent_typing_start', {
        detail: { channelId: 'channel-1', agentId: 'agent-1', agentName: 'Astrid' }
      }))
    })

    act(() => {
      window.dispatchEvent(new CustomEvent('chat_message_created', {
        detail: { channelId: 'channel-1', message: { author: { isAIAgent: false } } }
      }))
    })
    expect(result.current.isTyping).toBe(true)
  })

  it('should auto-clear after 45 second timeout', () => {
    const { result } = renderHook(() => useAgentTyping('channel-1'))

    act(() => {
      window.dispatchEvent(new CustomEvent('agent_typing_start', {
        detail: { channelId: 'channel-1', agentId: 'agent-1', agentName: 'Astrid' }
      }))
    })
    expect(result.current.isTyping).toBe(true)

    act(() => {
      vi.advanceTimersByTime(44_999)
    })
    expect(result.current.isTyping).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.isTyping).toBe(false)
  })

  it('should support taskId scope for comment typing indicators', () => {
    const { result } = renderHook(() => useAgentTyping(null, 'task-123'))

    act(() => {
      window.dispatchEvent(new CustomEvent('agent_typing_start', {
        detail: { taskId: 'task-123', agentId: 'agent-1', agentName: 'Astrid' }
      }))
    })
    expect(result.current.isTyping).toBe(true)

    act(() => {
      window.dispatchEvent(new CustomEvent('agent_typing_stop', {
        detail: { taskId: 'task-123', agentId: 'agent-1' }
      }))
    })
    expect(result.current.isTyping).toBe(false)
  })

  it('should clear typing on comment_created from AI agent', () => {
    const { result } = renderHook(() => useAgentTyping(null, 'task-123'))

    act(() => {
      window.dispatchEvent(new CustomEvent('agent_typing_start', {
        detail: { taskId: 'task-123', agentId: 'agent-1', agentName: 'Astrid' }
      }))
    })
    expect(result.current.isTyping).toBe(true)

    act(() => {
      window.dispatchEvent(new CustomEvent('comment_created', {
        detail: { taskId: 'task-123', comment: { isAgent: true } }
      }))
    })
    expect(result.current.isTyping).toBe(false)
  })

  it('should clean up event listeners on unmount', () => {
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useAgentTyping('channel-1'))

    unmount()

    const removedEvents = removeListenerSpy.mock.calls.map(c => c[0])
    expect(removedEvents).toContain('agent_typing_start')
    expect(removedEvents).toContain('agent_typing_stop')
    expect(removedEvents).toContain('chat_message_created')
    expect(removedEvents).toContain('comment_created')
    removeListenerSpy.mockRestore()
  })
})
