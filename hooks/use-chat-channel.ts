"use client"

import { useState, useEffect, useCallback, useRef } from 'react'
import type { ChatMessage } from '@/types/chat'

interface UseChatChannelProps {
  channelId: string | null
  currentUserId?: string
  enabled?: boolean
}

interface UseChatChannelReturn {
  messages: ChatMessage[]
  isLoading: boolean
  hasMore: boolean
  error: string | null
  sendMessage: (content: string, options?: {
    type?: 'TEXT' | 'MARKDOWN' | 'ATTACHMENT'
    attachmentUrl?: string
    attachmentName?: string
    attachmentType?: string
    attachmentSize?: number
    fileId?: string
    clientRequestId?: string
  }) => Promise<void>
  loadMore: () => Promise<void>
}

export function useChatChannel({
  channelId,
  currentUserId,
  enabled = true,
}: UseChatChannelProps): UseChatChannelReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextCursorRef = useRef<string | null>(null)
  const loadedChannelRef = useRef<string | null>(null)

  // Load initial messages when channelId changes
  useEffect(() => {
    if (!channelId || !enabled) {
      setMessages([])
      setHasMore(false)
      loadedChannelRef.current = null
      return
    }

    if (loadedChannelRef.current === channelId) return
    loadedChannelRef.current = channelId

    const loadMessages = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/v1/chat/channels/${channelId}/messages?limit=50`)
        if (!res.ok) throw new Error(`Failed to load messages: ${res.status}`)
        const data = await res.json()
        setMessages(data.messages)
        setHasMore(data.hasMore)
        nextCursorRef.current = data.nextCursor
      } catch (err) {
        console.error('[useChatChannel] Load error:', err)
        setError((err as Error).message)
      } finally {
        setIsLoading(false)
      }
    }

    loadMessages()
  }, [channelId, enabled])

  // Listen for SSE chat events via custom events from use-cache-sync
  useEffect(() => {
    if (!channelId || !enabled) return

    const handleNewMessage = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail.channelId !== channelId) return
      const message = detail.message as ChatMessage

      setMessages(prev => {
        // Avoid duplicates
        if (prev.some(m => m.id === message.id)) return prev
        return [...prev, message]
      })
    }

    const handleUpdatedMessage = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail.channelId !== channelId) return
      const message = detail.message as ChatMessage

      setMessages(prev =>
        prev.map(m => m.id === message.id ? message : m)
      )
    }

    const handleDeletedMessage = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail.channelId !== channelId) return

      setMessages(prev =>
        prev.filter(m => m.id !== detail.messageId)
      )
    }

    window.addEventListener('chat_message_created', handleNewMessage)
    window.addEventListener('chat_message_updated', handleUpdatedMessage)
    window.addEventListener('chat_message_deleted', handleDeletedMessage)

    return () => {
      window.removeEventListener('chat_message_created', handleNewMessage)
      window.removeEventListener('chat_message_updated', handleUpdatedMessage)
      window.removeEventListener('chat_message_deleted', handleDeletedMessage)
    }
  }, [channelId, enabled])

  // Load older messages
  const loadMore = useCallback(async () => {
    if (!channelId || !hasMore || !nextCursorRef.current || isLoading) return

    setIsLoading(true)
    try {
      const res = await fetch(
        `/api/v1/chat/channels/${channelId}/messages?limit=50&before=${encodeURIComponent(nextCursorRef.current)}`
      )
      if (!res.ok) throw new Error(`Failed to load more: ${res.status}`)
      const data = await res.json()

      setMessages(prev => [...data.messages, ...prev])
      setHasMore(data.hasMore)
      nextCursorRef.current = data.nextCursor
    } catch (err) {
      console.error('[useChatChannel] LoadMore error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [channelId, hasMore, isLoading])

  // Send a message with optimistic insert
  const sendMessage = useCallback(async (
    content: string,
    options?: {
      type?: 'TEXT' | 'MARKDOWN' | 'ATTACHMENT'
      attachmentUrl?: string
      attachmentName?: string
      attachmentType?: string
      attachmentSize?: number
      fileId?: string
      clientRequestId?: string
    }
  ) => {
    if (!channelId || !currentUserId) return

    const clientRequestId = options?.clientRequestId || `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`

    // Optimistic message
    const optimisticMessage: ChatMessage = {
      id: `optimistic_${clientRequestId}`,
      channelId,
      authorId: currentUserId,
      author: {
        id: currentUserId,
        name: null, // Will be filled by server response
        email: '',
        image: null,
        isAIAgent: false,
        aiAgentType: null,
      },
      content,
      type: options?.type || 'TEXT',
      attachmentUrl: options?.attachmentUrl || null,
      attachmentName: options?.attachmentName || null,
      attachmentType: options?.attachmentType || null,
      attachmentSize: options?.attachmentSize || null,
      replyToId: null,
      clientRequestId,
      createdAt: new Date().toISOString(),
    }

    setMessages(prev => [...prev, optimisticMessage])

    try {
      const res = await fetch(`/api/v1/chat/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          type: options?.type || 'TEXT',
          attachmentUrl: options?.attachmentUrl,
          attachmentName: options?.attachmentName,
          attachmentType: options?.attachmentType,
          attachmentSize: options?.attachmentSize,
          fileId: options?.fileId,
          clientRequestId,
        }),
      })

      if (!res.ok) throw new Error(`Failed to send: ${res.status}`)
      const data = await res.json()

      // Replace optimistic message with server response
      setMessages(prev =>
        prev.map(m =>
          m.clientRequestId === clientRequestId ? data.message : m
        )
      )
    } catch (err) {
      console.error('[useChatChannel] Send error:', err)
      // Remove optimistic message on failure
      setMessages(prev =>
        prev.filter(m => m.clientRequestId !== clientRequestId)
      )
      throw err
    }
  }, [channelId, currentUserId])

  return {
    messages,
    isLoading,
    hasMore,
    error,
    sendMessage,
    loadMore,
  }
}
