"use client"

import { useState, useEffect, useRef } from 'react'

interface UseListChatChannelProps {
  listId: string | null
  virtualListType?: string | null
  userId?: string
  enabled?: boolean
}

interface UseListChatChannelReturn {
  channelId: string | null
  isLoading: boolean
  error: string | null
}

/**
 * Resolves a listId or virtual list type to a chat channelId.
 * Calls POST /api/chat/channels to get-or-create the channel.
 */
export function useListChatChannel({
  listId,
  virtualListType,
  userId,
  enabled = true,
}: UseListChatChannelProps): UseListChatChannelReturn {
  const [channelId, setChannelId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setChannelId(null)
      setError(null)
      setIsLoading(false)
      lastKeyRef.current = null
      return
    }

    // Determine the key for this channel
    let key: string
    let body: Record<string, string>

    if (virtualListType && userId) {
      // Virtual list channels (My Tasks, Today, etc.)
      key = `virtual-chat:${userId}:${virtualListType}`
      body = { virtualKey: key }
    } else if (listId && !['my-tasks', 'today', 'not-in-list', 'public', 'assigned'].includes(listId)) {
      // Real list channels
      key = `list:${listId}`
      body = { listId }
    } else {
      // No channel for this selection
      setChannelId(null)
      return
    }

    // Skip if we already resolved this key
    if (lastKeyRef.current === key && channelId) return
    lastKeyRef.current = key

    const resolve = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/chat/channels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          if (res.status === 403 || res.status === 404) {
            setChannelId(null)
            setError(null)
            return
          }
          throw new Error(`Failed to resolve channel: ${res.status}`)
        }
        const data = await res.json()
        setChannelId(data.channel.id)
      } catch (err) {
        console.error('[useListChatChannel] Error:', err)
        setError((err as Error).message)
        setChannelId(null)
      } finally {
        setIsLoading(false)
      }
    }

    resolve()
  }, [listId, virtualListType, userId, enabled, channelId])

  return { channelId, isLoading, error }
}
