"use client"

import { useEffect, useState, useCallback, useRef } from 'react'
import { SSEManager, SSEEvent } from '@/lib/sse-manager'
import type { Task, Comment } from '@/types/task'

/** AI Agent event data */
export interface AIAgentEventData {
  taskId: string
  agentId?: string
  agentType?: string
  message?: string
  timestamp?: string
}

/** Coding workflow event data */
export interface CodingWorkflowEventData {
  taskId: string
  workflowId?: string
  assigneeId?: string
  aiService?: string
  commentId?: string
  status?: string
  prNumber?: number
  prUrl?: string
  branchName?: string
  message?: string
  error?: string
  timestamp?: string
}

/**
 * Simplified hook for subscribing to SSE events
 * Uses centralized SSE Manager to avoid connection cycling
 */
export function useSSESubscription(
  eventTypes: string | string[] | readonly string[],
  callback: (event: SSEEvent) => void,
  options: {
    componentName?: string
    enabled?: boolean
    onReconnection?: () => void
  } = {}
) {
  const { componentName = 'UnknownComponent', enabled = true, onReconnection } = options
  const [isConnected, setIsConnected] = useState(false)

  // Use ref to store callback to prevent re-subscription on callback changes
  const callbackRef = useRef(callback)
  const onReconnectionRef = useRef(onReconnection)

  // Update ref when callback changes
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  // Update ref when onReconnection changes
  useEffect(() => {
    onReconnectionRef.current = onReconnection
  }, [onReconnection])

  // Subscribe to connection state changes
  useEffect(() => {
    const unsubscribeConnection = SSEManager.onConnectionChange(setIsConnected)
    return unsubscribeConnection
  }, [])

  // Subscribe to reconnection events
  useEffect(() => {
    if (!enabled || !onReconnectionRef.current) {
      return
    }

    const handleReconnection = () => {
      if (onReconnectionRef.current) {
        onReconnectionRef.current()
      }
    }

    const unsubscribeReconnection = SSEManager.onReconnection(handleReconnection)
    return unsubscribeReconnection
  }, [enabled])

  // Subscribe to SSE events
  useEffect(() => {
    if (!enabled) {
      return
    }

    // Debug: Setting up SSE subscription for events

    // Use a stable wrapper function that calls the current callback
    const stableCallback = (event: SSEEvent) => {
      callbackRef.current(event)
    }

    const unsubscribe = SSEManager.subscribe(
      eventTypes,
      stableCallback,
      componentName
    )

    return () => {
      // Debug: Cleaning up SSE subscription
      unsubscribe()
    }
  }, [eventTypes, componentName, enabled]) // Removed callback from dependencies

  return {
    isConnected,
    connectionStatus: SSEManager.getConnectionStatus()
  }
}

/**
 * Hook for components that just need to know connection status
 */
export function useSSEConnectionStatus() {
  const [isConnected, setIsConnected] = useState(false)
  const [status, setStatus] = useState(SSEManager.getConnectionStatus())

  useEffect(() => {
    const unsubscribeConnection = SSEManager.onConnectionChange(setIsConnected)

    // Update status periodically
    const statusInterval = setInterval(() => {
      setStatus(SSEManager.getConnectionStatus())
    }, 5000)

    return () => {
      unsubscribeConnection()
      clearInterval(statusInterval)
    }
  }, [])

  return {
    isConnected,
    connectionAttempts: status.connectionAttempts,
    lastEventTime: status.lastEventTime,
    subscriptionCount: status.subscriptionCount
  }
}

// Stable event type arrays to prevent re-subscriptions
const TASK_EVENT_TYPES = [
  'task_created',
  'task_updated',
  // Sent INSTEAD of task_updated when the change completed the task; unheard,
  // a completion by anyone else never showed until a refresh (AWTD-1039).
  'task_completed',
  'task_deleted',
  'comment_created',
  'comment_updated',
  'comment_deleted'
] as const

// Stable event type arrays for AI agent events
const AI_AGENT_EVENT_TYPES = [
  'ai_agent_assigned',
  'ai_agent_commented',
  'ai_agent_task_updated'
] as const

// Stable event type arrays for coding workflow
const CODING_WORKFLOW_EVENT_TYPES = [
  'coding_task_assigned',
  'coding_plan_approved',
  'coding_merge_requested',
  'coding_task_completed',
  'coding_task_failed'
] as const

/**
 * Hook for task-related SSE events
 * Provides commonly needed task event subscriptions
 */
export function useTaskSSEEvents(callbacks: {
  onTaskCreated?: (task: Task) => void
  onTaskUpdated?: (task: Partial<Task> & { id: string }) => void
  onTaskDeleted?: (taskId: string) => void
  onCommentCreated?: (comment: Comment) => void
  onCommentUpdated?: (comment: Partial<Comment> & { id: string }) => void
  onCommentDeleted?: (commentId: string) => void
}, options: { enabled?: boolean; componentName?: string } = {}) {

  const { enabled = true, componentName = 'TaskComponent' } = options

  // Use ref to store callbacks to prevent re-subscription on callback changes
  const callbacksRef = useRef(callbacks)

  // Update ref when callbacks change
  useEffect(() => {
    callbacksRef.current = callbacks
  }, [callbacks])

  const handleTaskEvent = useCallback((event: SSEEvent) => {
    const currentCallbacks = callbacksRef.current
    switch (event.type) {
      case 'task_created':
        if (currentCallbacks.onTaskCreated) {
          if (event.data) {
            currentCallbacks.onTaskCreated(event.data)
          } else {
            console.error('❌ [SSE] task_created event missing data:', event)
          }
        }
        break
      case 'task_updated':
      case 'task_completed':
        if (currentCallbacks.onTaskUpdated) {
          if (event.data) {
            currentCallbacks.onTaskUpdated(event.data)
          } else {
            console.error('❌ [SSE] task_updated event missing data:', event)
          }
        }
        break
      case 'task_deleted':
        if (currentCallbacks.onTaskDeleted) {
          if (event.data?.id) {
            currentCallbacks.onTaskDeleted(event.data.id)
          } else {
            console.error('❌ [SSE] task_deleted event missing data.id:', event)
          }
        }
        break
      case 'comment_created':
        if (currentCallbacks.onCommentCreated) {
          // Ensure data exists before passing to callback
          if (event.data) {
            currentCallbacks.onCommentCreated(event.data)
          } else {
            console.error('❌ [SSE] comment_created event missing data:', event)
          }
        }
        break
      case 'comment_updated':
        if (currentCallbacks.onCommentUpdated) {
          if (event.data) {
            currentCallbacks.onCommentUpdated(event.data)
          } else {
            console.error('❌ [SSE] comment_updated event missing data:', event)
          }
        }
        break
      case 'comment_deleted':
        if (currentCallbacks.onCommentDeleted) {
          if (event.data?.id) {
            currentCallbacks.onCommentDeleted(event.data.id)
          } else {
            console.error('❌ [SSE] comment_deleted event missing data.id:', event)
          }
        }
        break
      default:
        // Debug: Unhandled task event
    }
  }, []) // callbacks stored in ref to avoid re-subscription

  return useSSESubscription(TASK_EVENT_TYPES, handleTaskEvent, {
    componentName,
    enabled
  })
}

/**
 * Hook for AI Agent SSE events
 */
export function useAIAgentSSEEvents(callbacks: {
  onAgentAssigned?: (data: AIAgentEventData) => void
  onAgentCommented?: (data: AIAgentEventData) => void
  onAgentTaskUpdated?: (data: AIAgentEventData) => void
}, options: { enabled?: boolean; componentName?: string } = {}) {

  const { enabled = true, componentName = 'AIAgentComponent' } = options

  // Use ref to store callbacks to prevent re-subscription on callback changes
  const callbacksRef = useRef(callbacks)

  // Update ref when callbacks change
  useEffect(() => {
    callbacksRef.current = callbacks
  }, [callbacks])

  const handleAIAgentEvent = useCallback((event: SSEEvent) => {
    const currentCallbacks = callbacksRef.current
    switch (event.type) {
      case 'ai_agent_assigned':
        if (currentCallbacks.onAgentAssigned) {
          currentCallbacks.onAgentAssigned(event.data)
        }
        break
      case 'ai_agent_commented':
        if (currentCallbacks.onAgentCommented) {
          currentCallbacks.onAgentCommented(event.data)
        }
        break
      case 'ai_agent_task_updated':
        if (currentCallbacks.onAgentTaskUpdated) {
          currentCallbacks.onAgentTaskUpdated(event.data)
        }
        break
      default:
        // Debug: Unhandled AI agent event
    }
  }, []) // callbacks stored in ref to avoid re-subscription

  return useSSESubscription(AI_AGENT_EVENT_TYPES, handleAIAgentEvent, {
    componentName,
    enabled
  })
}

/**
 * Hook for coding workflow SSE events
 */
export function useCodingWorkflowSSEEvents(callbacks: {
  onTaskAssigned?: (data: CodingWorkflowEventData) => void
  onPlanApproved?: (data: CodingWorkflowEventData) => void
  onMergeRequested?: (data: CodingWorkflowEventData) => void
  onTaskCompleted?: (data: CodingWorkflowEventData) => void
  onTaskFailed?: (data: CodingWorkflowEventData) => void
}, options: { enabled?: boolean; componentName?: string } = {}) {

  const { enabled = true, componentName = 'CodingWorkflowComponent' } = options

  // Use ref to store callbacks to prevent re-subscription on callback changes
  const callbacksRef = useRef(callbacks)

  // Update ref when callbacks change
  useEffect(() => {
    callbacksRef.current = callbacks
  }, [callbacks])

  const handleCodingEvent = useCallback((event: SSEEvent) => {
    const currentCallbacks = callbacksRef.current
    switch (event.type) {
      case 'coding_task_assigned':
        if (currentCallbacks.onTaskAssigned) {
          currentCallbacks.onTaskAssigned(event.data)
        }
        break
      case 'coding_plan_approved':
        if (currentCallbacks.onPlanApproved) {
          currentCallbacks.onPlanApproved(event.data)
        }
        break
      case 'coding_merge_requested':
        if (currentCallbacks.onMergeRequested) {
          currentCallbacks.onMergeRequested(event.data)
        }
        break
      case 'coding_task_completed':
        if (currentCallbacks.onTaskCompleted) {
          currentCallbacks.onTaskCompleted(event.data)
        }
        break
      case 'coding_task_failed':
        if (currentCallbacks.onTaskFailed) {
          currentCallbacks.onTaskFailed(event.data)
        }
        break
      default:
        // Debug: Unhandled coding event
    }
  }, []) // callbacks stored in ref to avoid re-subscription

  return useSSESubscription(CODING_WORKFLOW_EVENT_TYPES, handleCodingEvent, {
    componentName,
    enabled
  })
}
