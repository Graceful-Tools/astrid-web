import { isOfflineMode, OfflineSyncManager } from './offline-sync'
import { OfflineTaskOperations } from './offline-db'
import { createLogger } from '@/lib/logger'
import { z } from 'zod'
import { decodeV1Resource, type DecodedV1Resource } from '@/lib/v1-response'

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

export class ApiError<TError = unknown> extends Error {
  readonly name = 'ApiError'

  constructor(
    message: string,
    readonly status: number,
    readonly endpoint: string,
    readonly detail: unknown,
    readonly validatedDetail: TError | null,
  ) {
    super(message)
  }
}

export const apiCall = async <TError = unknown>(
  endpoint: string,
  options: RequestInit = {},
  errorSchema?: z.ZodType<TError>,
) => {
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
      let errorDetail: unknown = null
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

      const detailRecord =
        errorDetail && typeof errorDetail === 'object'
          ? errorDetail as Record<string, unknown>
          : null
      const detailValue =
        detailRecord?.error ?? detailRecord?.message ?? detailRecord?.details
      const detailMessage = errorDetail
        ? typeof errorDetail === 'string'
          ? errorDetail
          : typeof detailValue === 'string'
            ? detailValue
            : JSON.stringify(errorDetail)
        : ''
      const parsedDetail = errorSchema?.safeParse(errorDetail)
      const error = new ApiError<TError>(
        `API call failed: ${response.status} ${response.statusText}${detailMessage ? ` - ${detailMessage}` : ''}`,
        response.status,
        endpoint,
        errorDetail,
        parsedDetail?.success ? parsedDetail.data : null,
      )
      // Invalidate cache on API errors
      triggerCacheInvalidation(endpoint, error)
      throw error
    }

    return response
  } catch (error) {
    // Only invalidate cache on network errors (not API errors which were already handled above)
    if (error instanceof Error && !(error instanceof ApiError)) {
      triggerCacheInvalidation(endpoint, error)
    }
    throw error
  }
}

export const apiGet = (endpoint: string, options: RequestInit = {}) => apiCall(endpoint, options)

export async function apiJson<TSuccess, TError = unknown>(
  endpoint: string,
  successSchema: z.ZodType<TSuccess>,
  options: RequestInit = {},
  errorSchema?: z.ZodType<TError>,
): Promise<TSuccess> {
  const response = await apiCall(endpoint, options, errorSchema)
  const body: unknown = await response.json()
  return successSchema.parse(body)
}

export async function apiV1Resource<TSuccess, K extends string, TError = unknown>(
  endpoint: string,
  key: K,
  resourceSchema: z.ZodType<TSuccess>,
  options: RequestInit = {},
  errorSchema?: z.ZodType<TError>,
): Promise<DecodedV1Resource<TSuccess>> {
  const body = await apiJson(endpoint, z.unknown(), options, errorSchema)
  return decodeV1Resource(body, key, resourceSchema)
}

export const apiPost = async <TBody extends object>(
  endpoint: string,
  data: TBody,
  options: RequestInit = {},
) => {
  // Check if offline
  if (isOfflineMode()) {
    // Handle different endpoint patterns
    let entity: 'task' | 'list' | 'comment' | null = null
    let tempId = `temp-${Date.now()}`

    // Check for nested comment endpoint: /api/tasks/{taskId}/comments
    const commentMatch = endpoint.match(/\/api\/(?:v1\/)?tasks\/([^\/]+)\/comments/)
    if (commentMatch) {
      entity = 'comment'
      const userId = 'userId' in data ? data.userId : undefined
      const user = 'user' in data ? data.user : undefined
      const content = 'content' in data ? data.content : undefined

      // Validate that we have user data (must be authenticated)
      if (!userId && !user) {
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
        content,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        taskId: commentMatch[1],
        userId: userId || '',
        user: user || { id: '', name: 'You', email: '' },
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

  return apiCall(endpoint, { ...options, method: "POST", body: JSON.stringify(data) })
}

export const apiPut = async <TBody extends object>(
  endpoint: string,
  data: TBody,
  options: RequestInit = {},
) => {
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
        'PUT',
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

  const response = await apiCall(endpoint, { ...options, method: "PUT", body: JSON.stringify(data) })
  await persistTaskResponseToCache(endpoint, response)
  return response
}

/**
 * Put a server-confirmed task into the cache (task aaccb172).
 *
 * WHY THIS LIVES HERE. There were two update stacks: useTaskOperations
 * persisted to IndexedDB, and useTaskManagerController.handleUpdateTask — the
 * one bound to `onUpdate` for every field editor, board card and list row —
 * did not. An edit made while online was invisible to the offline cache until a
 * full re-sync. apiPut is the choke point all of them already pass through, so
 * fixing it once covers the call sites nobody has enumerated, and leaves the
 * controller's optimistic/rollback logic alone.
 *
 * The SERVER's copy is what gets stored, not the caller's optimistic object:
 * the server normalises, stamps updatedAt, and may not accept everything sent.
 *
 * NEVER FAILS THE WRITE. The save already succeeded by this point; a cache
 * problem must not make it look otherwise. CacheManager.setTask swallows
 * IndexedDB errors internally, and this swallows anything else — including a
 * body that is not JSON.
 *
 * TASKS ONLY, deliberately. Lists and comments have different response shapes
 * and are not what this fix is about; they still do not populate the cache.
 */
async function persistTaskResponseToCache(endpoint: string, response: Response): Promise<void> {
  if (!response.ok) return
  if (!/\/api\/(?:v1\/)?tasks\/[^\/]+$/.test(endpoint)) return

  try {
    // Cloned so the caller can still read the body.
    const body = await response.clone().json()
    const task = body?.task ?? body
    if (!task?.id) return

    const { CacheManager } = await import('./cache-manager')
    await CacheManager.setTask(task)
  } catch {
    // A successful save must not be reported as failed because the cache
    // could not be updated.
  }
}

export const apiDelete = async (endpoint: string, options: RequestInit = {}) => {
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

  return apiCall(endpoint, { ...options, method: "DELETE" })
}
