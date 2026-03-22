"use client"

import { useState, useEffect, useRef } from 'react'

export interface AgentTypingState {
  isTyping: boolean
  agentName: string | null
  agentId: string | null
}

const TYPING_TIMEOUT_MS = 45_000

/**
 * Track agent typing state for a chat channel or task comment thread.
 * Pass channelId for chat messages, taskId for task comments.
 */
export function useAgentTyping(channelId: string | null, taskId?: string | null): AgentTypingState {
  const [state, setState] = useState<AgentTypingState>({ isTyping: false, agentName: null, agentId: null })
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scopeId = channelId || taskId

  useEffect(() => {
    if (!scopeId) return

    const clearTyping = () => {
      setState({ isTyping: false, agentName: null, agentId: null })
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }

    const handleTypingStart = (e: Event) => {
      const detail = (e as CustomEvent).detail
      // Match on channelId (chat) or taskId (comments)
      if (detail.channelId !== scopeId && detail.taskId !== scopeId) return

      setState({ isTyping: true, agentName: detail.agentName || 'Agent', agentId: detail.agentId })

      // Safety timeout — auto-clear if stop event never arrives
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(clearTyping, TYPING_TIMEOUT_MS)
    }

    const handleTypingStop = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail.channelId !== scopeId && detail.taskId !== scopeId) return
      clearTyping()
    }

    const handleNewMessage = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail.channelId !== scopeId) return
      // Any new message from an AI agent clears the indicator
      if (detail.message?.author?.isAIAgent) {
        clearTyping()
      }
    }

    const handleNewComment = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail.taskId !== scopeId) return
      // Any new comment from an AI agent clears the indicator
      if (detail.comment?.isAgent) {
        clearTyping()
      }
    }

    window.addEventListener('agent_typing_start', handleTypingStart)
    window.addEventListener('agent_typing_stop', handleTypingStop)
    window.addEventListener('chat_message_created', handleNewMessage)
    window.addEventListener('comment_created', handleNewComment)

    return () => {
      window.removeEventListener('agent_typing_start', handleTypingStart)
      window.removeEventListener('agent_typing_stop', handleTypingStop)
      window.removeEventListener('chat_message_created', handleNewMessage)
      window.removeEventListener('comment_created', handleNewComment)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [scopeId])

  return state
}
