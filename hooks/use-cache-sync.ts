"use client"

/**
 * SSE-Cache Integration Hook
 * Listens to SSE events and updates the cache accordingly
 *
 * This hook should be mounted once at the app level to keep caches in sync
 */

import React, { useEffect, useCallback, useRef } from 'react'
import { useSSESubscription } from './use-sse-subscription'
import { CacheManager } from '@/lib/cache-manager'
import { SSEManager } from '@/lib/sse-manager'
import type { Task, Comment, TaskList } from '@/types/task'

// SSE event types that affect the cache
const CACHE_SYNC_EVENTS = [
  'task_created',
  'task_updated',
  'task_deleted',
  'comment_created',
  'comment_updated',
  'comment_deleted',
  'list_created',
  'list_updated',
  'list_deleted',
  'list_member_added',
  'list_member_removed',
  'list_member_updated'
] as const

type CacheSyncEventType = typeof CACHE_SYNC_EVENTS[number]

interface SSECacheEvent {
  type: CacheSyncEventType
  timestamp: string
  data: {
    task?: Task
    taskId?: string
    comment?: Comment
    commentId?: string
    list?: TaskList
    listId?: string
    userId?: string
    member?: any
  }
}

/**
 * Hook to sync SSE events with local cache
 * Mount this once at the app/layout level
 */
export function useCacheSync() {
  const isProcessingRef = useRef(false)
  // Dedup: track recently processed events to prevent rapid-fire loops
  const recentEventKeys = useRef(new Map<string, number>())

  // Handle SSE events
  const handleSSEEvent = useCallback(async (event: SSECacheEvent) => {
    // Prevent concurrent processing
    if (isProcessingRef.current) {
      return
    }

    // Dedup: skip if we processed the same entity event within 500ms
    const entityId = event.data.task?.id || event.data.taskId || event.data.comment?.id || event.data.commentId || event.data.list?.id || event.data.listId
    if (entityId) {
      const dedupKey = `${event.type}:${entityId}`
      const now = Date.now()
      const lastProcessed = recentEventKeys.current.get(dedupKey)
      if (lastProcessed && now - lastProcessed < 500) {
        return // Skip duplicate
      }
      recentEventKeys.current.set(dedupKey, now)
      // Cleanup old entries periodically
      if (recentEventKeys.current.size > 100) {
        const cutoff = now - 5000
        for (const [key, ts] of recentEventKeys.current) {
          if (ts < cutoff) recentEventKeys.current.delete(key)
        }
      }
    }

    isProcessingRef.current = true

    try {
      switch (event.type) {
        // Task events
        case 'task_created':
        case 'task_updated':
          if (event.data.task) {
            // skipCrossTabSync=true: all tabs receive SSE independently, no need to re-broadcast
            await CacheManager.setTask(event.data.task, true, true)
            if (process.env.NODE_ENV === 'development') {
              console.log(`📥 [CacheSync] ${event.type}:`, event.data.task.id)
            }
          }
          break

        case 'task_deleted':
          if (event.data.taskId) {
            await CacheManager.removeTask(event.data.taskId, true)
            if (process.env.NODE_ENV === 'development') {
              console.log(`📥 [CacheSync] task_deleted:`, event.data.taskId)
            }
          }
          break

        // Comment events
        case 'comment_created':
        case 'comment_updated':
          if (event.data.comment) {
            await CacheManager.setComment(event.data.comment, true, true)
            if (process.env.NODE_ENV === 'development') {
              console.log(`📥 [CacheSync] ${event.type}:`, event.data.comment.id)
            }
          }
          break

        case 'comment_deleted':
          if (event.data.commentId && event.data.taskId) {
            await CacheManager.removeComment(event.data.commentId, event.data.taskId, true)
            if (process.env.NODE_ENV === 'development') {
              console.log(`📥 [CacheSync] comment_deleted:`, event.data.commentId)
            }
          }
          break

        // List events
        case 'list_created':
        case 'list_updated':
          if (event.data.list) {
            await CacheManager.setList(event.data.list, true, true)
            if (process.env.NODE_ENV === 'development') {
              console.log(`📥 [CacheSync] ${event.type}:`, event.data.list.id)
            }
          }
          break

        case 'list_deleted':
          if (event.data.listId) {
            await CacheManager.removeList(event.data.listId, true)
            if (process.env.NODE_ENV === 'development') {
              console.log(`📥 [CacheSync] list_deleted:`, event.data.listId)
            }
          }
          break

        // List member events - invalidate cache
        case 'list_member_added':
        case 'list_member_removed':
        case 'list_member_updated':
          if (event.data.listId) {
            // Invalidate the list to force refresh of members
            CacheManager.invalidateEntity('list', event.data.listId)
            if (process.env.NODE_ENV === 'development') {
              console.log(`📥 [CacheSync] ${event.type}: invalidated list`, event.data.listId)
            }
          }
          break
      }
    } catch (error) {
      console.error('❌ [CacheSync] Error processing SSE event:', error)
    } finally {
      isProcessingRef.current = false
    }
  }, [])

  // Subscribe to SSE events
  useSSESubscription(
    CACHE_SYNC_EVENTS as unknown as string[],
    handleSSEEvent as any,
    { componentName: 'CacheSync' }
  )

  // Handle reconnection - refresh stale data
  useEffect(() => {
    const unsubscribe = SSEManager.onReconnection(async () => {
      if (process.env.NODE_ENV === 'development') {
        console.log('🔄 [CacheSync] SSE reconnected - invalidating stale caches')
      }

      // Invalidate all memory caches on reconnection
      // This forces fresh data fetch on next access
      CacheManager.invalidateEntity('task')
      CacheManager.invalidateEntity('list')
      CacheManager.invalidateEntity('comment')
    })

    return unsubscribe
  }, [])
}

/**
 * Provider component for cache sync
 * Add this to your root layout
 *
 * Usage in layout.tsx:
 * import { CacheSyncProvider } from '@/hooks/use-cache-sync'
 * <CacheSyncProvider>{children}</CacheSyncProvider>
 */
export function CacheSyncProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  useCacheSync()
  return children
}

export default useCacheSync
