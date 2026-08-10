/**
 * Queued offline task mutations must target endpoints that exist (task 22fb004d).
 *
 * Editing a task offline queued `PATCH /api/tasks/[id]`. That route exports
 * GET, PUT and DELETE only, so the App Router answers **405**, and
 * `OfflineSyncManager.processMutation` throws `HTTP 405` on replay. The edit
 * never reached the server.
 *
 * The failure is invisible, which is what makes it worth a test: IndexedDB
 * still holds the change, so the task looks correctly edited until the cache is
 * cleared or another device is opened, at which point the edit is simply gone.
 *
 * Queueing legacy PUT would not have fixed it either — that handler rejects a
 * body with no title, and a queued edit is a partial update. The online path in
 * the same hook already uses `PUT /api/v1/tasks/[id]`, which does partial
 * updates, so the queued mutation matches it now.
 *
 * Third caller in this family after cde681e4 fixed the reminder notification
 * and the OAuth client, and the only one with real user impact.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const queueMutation = vi.fn()

vi.mock('@/lib/offline-sync', () => ({
  OfflineSyncManager: { queueMutation: (...a: unknown[]) => queueMutation(...a) },
  // The whole point of this path: the app believes it is offline.
  isOfflineMode: () => true,
}))

vi.mock('@/lib/offline-db', () => ({
  OfflineTaskOperations: {
    saveTask: vi.fn(),
    deleteTask: vi.fn(),
    getTask: vi.fn(async () => ({ id: 'task-1', title: 'Old', completed: false })),
    getTasks: vi.fn(async () => []),
  },
}))

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

import { useTaskOperations } from '@/hooks/useTaskOperations'

/** The (endpoint, method) pair queueMutation was called with. */
function queuedCall(index = 0) {
  const call = queueMutation.mock.calls[index]
  return { endpoint: call?.[3] as string, method: call?.[4] as string }
}

function setup() {
  return renderHook(() =>
    useTaskOperations({
      tasks: [{ id: 'task-1', title: 'Old', completed: false } as never],
      setTasks: vi.fn(),
      onTaskCreated: vi.fn(),
      onTaskUpdated: vi.fn(),
      onTaskDeleted: vi.fn(),
    } as never)
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('offline task mutations target real endpoints (task 22fb004d)', () => {
  it('queues an edit with a method the route implements', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.updateTask('task-1', { title: 'New' })
    })

    const { endpoint, method } = queuedCall()
    // PATCH is a 405 on this resource — the whole bug.
    expect(method).not.toBe('PATCH')
    expect(method).toBe('PUT')
    expect(endpoint).toBe('/api/v1/tasks/task-1')
  })

  it('queues the edit against v1, which accepts a partial body', async () => {
    // Legacy PUT would 400: it requires a title, and a queued edit is partial.
    const { result } = setup()

    await act(async () => {
      await result.current.updateTask('task-1', { completed: true })
    })

    expect(queuedCall().endpoint.startsWith('/api/v1/')).toBe(true)
  })
})
