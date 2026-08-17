import { isOfflineMode, OfflineSyncManager } from './offline-sync'
import { OfflineTaskOperations } from './offline-db'
import { createLogger } from '@/lib/logger'

const log = createLogger('api')


const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || ""

// Cache invalidation listeners
type CacheInvalidationListener = () => void
const cacheInvalidationListeners = new Set<CacheInvalidationListener>()

/**
 * Subscribe to cache invalidation events (triggered on API errors)
 * Returns unsubscribe function
 */
export const onCacheInvalidation = (callback: CacheInvalidationListener): (() => void) => {
  cacheInvalidationListeners.add(callback)
  return () => {
    cacheInvalidationListeners.delete(callback)
  }
}

/**
 * Trigger cache invalidation (called on API errors)
 */
const triggerCacheInvalidation = (endpoint: string, error: Error) => {
  cacheInvalidationListeners.forEach(callback => {
    try {
      callback()
    } catch (err) {
      log.error({ err: err }, 'Error in cache invalidation listener:')
    }
  })
}

export const apiCall = async (endpoint: string, options: RequestInit = {}) => {
  const url = API_BASE_URL ? `${API_BASE_URL}${endpoint}` : endpoint

  const defaultOptions: RequestInit = {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  }

  try {
    const response = await fetch(url, {
      ...defaultOptions,
      ...options,
    })

    if (!response.ok) {
      let errorDetail: any = null
      try {
        const contentType = response.headers.get('content-type')
        if (contentType && contentType.includes('application/json')) {
          errorDetail = await response.clone().json()
        } else {
          errorDetail = await response.clone().text()
        }
      } catch {
        // Swallow parse errors; errorDetail remains null
      }

      const detailMessage = errorDetail
        ? typeof errorDetail === 'string'
          ? errorDetail
          : errorDetail.error || errorDetail.message || errorDetail.details || JSON.stringify(errorDetail)
        : ''
      const error = new Error(
        `API call failed: ${response.status} ${response.statusText}${detailMessage ? ` - ${detailMessage}` : ''}`
      ) as Error & { status?: number; detail?: any; endpoint?: string }
      error.status = response.status
      error.detail = errorDetail
      error.endpoint = endpoint
      // Invalidate cache on API errors
      triggerCacheInvalidation(endpoint, error)
      throw error
    }

    return response
  } catch (error) {
    // Only invalidate cache on network errors (not API errors which were already handled above)
    if (error instanceof Error && !error.message.startsWith('API call failed:')) {
      triggerCacheInvalidation(endpoint, error)
    }
    throw error
  }
}

export const apiGet = (endpoint: string) => apiCall(endpoint)

export const apiPost = async (endpoint: string, data: any) => {
  // Check if offline
  if (isOfflineMode()) {
    // Handle different endpoint patterns
    let entity: 'task' | 'list' | 'comment' | null = null
    let tempId = `temp-${Date.now()}`

    // Check for nested comment endpoint: /api/tasks/{taskId}/comments
    const commentMatch = endpoint.match(/\/api\/(?:v1\/)?tasks\/([^\/]+)\/comments/)
    if (commentMatch) {
      entity = 'comment'

      // Validate that we have user data (must be authenticated)
      if (!data.userId && !data.user) {
        // Not authenticated - return auth error instead of trying to queue
        return new Response(JSON.stringify({
          error: 'Unauthorized',
          message: 'You must be logged in to add comments'
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      // Queue mutation for sync
      await OfflineSyncManager.queueMutation(
        'create',
        entity,
        tempId,
        endpoint,
        'POST',
        data
      )

      // Return a fake comment response
      return new Response(JSON.stringify({
        id: tempId,
        content: data.content,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        taskId: commentMatch[1],
        userId: data.userId || '',
        user: data.user || { id: '', name: 'You', email: '' },
        ...data
      }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Check for direct entity endpoints: /api/tasks, /api/lists
    const directMatch = endpoint.match(/\/api\/(?:v1\/)?(tasks|lists)$/)
    if (directMatch) {
      entity = directMatch[1].slice(0, -1) as 'task' | 'list' // Remove 's'

      // Queue mutation for sync
      await OfflineSyncManager.queueMutation(
        'create',
        entity,
        tempId,
        endpoint,
        'POST',
        data
      )

      // Return a fake response for offline mode
      return new Response(JSON.stringify({ ...data, id: tempId }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  }

  return apiCall(endpoint, { method: "POST", body: JSON.stringify(data) })
}

export const apiPut = async (endpoint: string, data: any) => {
  // The `(?:v1\/)?` in every matcher below is load-bearing (task f2178a55).
  //
  // These patterns were written when the only routes were /api/tasks and
  // /api/lists. `/api/v1/tasks/abc` does not match `/api/(tasks|lists)/...` —
  // the segment after /api/ is `v1` — so when the callers moved to v1 the
  // offline queue silently stopped firing for every one of them, without a line
  // of the offline machinery changing. Editing a task with no connection
  // dropped the edit; promoting a subtask, still on the legacy route, kept
  // working. That asymmetry is what surfaced it.
  //
  // Non-capturing on purpose: the entity name is derived from the NEXT group
  // (`taskMatch[1].slice(0, -1)`), so a capturing group here would shift it.
  //
  // Deliberately still anchored on the entity segment rather than loosened
  // further: `/api/v1/users/me/smart-tasks` ends in "tasks" and must not be
  // queued as a task mutation. tests/lib/api-offline-queue-v1-urls.test.ts
  // pins that case alongside the ones that should queue.
  // Check if offline or updating a temp task
  const taskIdMatch = endpoint.match(/\/api\/(?:v1\/)?tasks\/(temp-[^\/]+)/)
  const listIdMatch = endpoint.match(/\/api\/(?:v1\/)?lists\/(temp-[^\/]+)/)

  if (isOfflineMode() || taskIdMatch || listIdMatch) {
    // Extract entity type and ID
    const taskMatch = endpoint.match(/\/api\/(?:v1\/)?(tasks|lists|comments)\/([^\/]+)/)
    if (taskMatch) {
      const entity = taskMatch[1].slice(0, -1) as 'task' | 'list' | 'comment' // Remove 's' from plural
      const entityId = taskMatch[2]

      // If it's a temp task/list, update in IndexedDB
      if (entityId.startsWith('temp-')) {
        if (entity === 'task') {
          const existingTask = await OfflineTaskOperations.getTask(entityId)
          if (existingTask) {
            const updatedTask = { ...existingTask, ...data, updatedAt: new Date() }
            await OfflineTaskOperations.saveTask(updatedTask)

            // Return fake response
            return new Response(JSON.stringify({ task: updatedTask }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            })
          }
        }
      }

      // Queue mutation for sync
      await OfflineSyncManager.queueMutation(
        'update',
        entity,
        entityId,
        endpoint,
        'PATCH',
        data
      )

      // If offline, update IndexedDB and return fake response
      if (isOfflineMode()) {
        if (entity === 'task') {
          const existingTask = await OfflineTaskOperations.getTask(entityId)
          if (existingTask) {
            const updatedTask = { ...existingTask, ...data, updatedAt: new Date() }
            await OfflineTaskOperations.saveTask(updatedTask)

            return new Response(JSON.stringify({ task: updatedTask }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            })
          }
        }

        // Return fake response for other entities
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }
  }

  return apiCall(endpoint, { method: "PUT", body: JSON.stringify(data) })
}

export const apiDelete = async (endpoint: string) => {
  // Check if offline
  if (isOfflineMode()) {
    const match = endpoint.match(/\/api\/(?:v1\/)?(tasks|lists|comments)\/([^\/]+)/)
    if (match) {
      const entity = match[1].slice(0, -1) as 'task' | 'list' | 'comment'
      const entityId = match[2]

      // Delete from IndexedDB
      if (entity === 'task') {
        await OfflineTaskOperations.deleteTask(entityId)
      }

      // Queue mutation for sync
      await OfflineSyncManager.queueMutation(
        'delete',
        entity,
        entityId,
        endpoint,
        'DELETE'
      )

      // Return fake response
      return new Response(null, { status: 204 })
    }
  }

  return apiCall(endpoint, { method: "DELETE" })
}
