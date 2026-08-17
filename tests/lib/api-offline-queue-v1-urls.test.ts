/**
 * The offline queue must recognise v1 URLs (task f2178a55).
 *
 * lib/api.ts decides whether to queue a write by matching the endpoint:
 *
 *     /\/api\/(tasks|lists|comments)\/([^\/]+)/
 *
 * That pattern was written when the only routes were /api/tasks and /api/lists.
 * It does not match /api/v1/tasks/abc — the segment after /api/ is `v1`. So the
 * v1 migration switched the offline queue OFF for everything it moved, silently
 * and without touching a line of the offline machinery.
 *
 * WHAT THAT COSTS A USER: every task write goes to v1
 * (hooks/useTaskManagerController.ts:607, hooks/useTaskOperations.ts:462), so
 * editing a task with no connection queues nothing and the edit is lost.
 * Meanwhile subtask promotion still uses legacy /api/tasks/{id}
 * (hooks/task-manager/useTaskDragDrop.ts:498) and queues correctly — so one
 * gesture survives going offline and another does not.
 *
 * THE NEGATIVE CASES CARRY THE MOST WEIGHT HERE. Widening a matcher is easy to
 * overdo: /api/v1/users/me/smart-tasks ends in "tasks" and must NOT be treated
 * as a task entity, and neither the collection endpoints nor unrelated v1
 * routes should start queueing. Those are asserted below alongside the fix.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const queueMutation = vi.fn()
const saveTask = vi.fn()

vi.mock('@/lib/offline-sync', () => ({
  OfflineSyncManager: { queueMutation: (...a: unknown[]) => queueMutation(...a) },
  // Every case in this file is "the app believes it is offline".
  isOfflineMode: () => true,
}))

vi.mock('@/lib/offline-db', () => ({
  OfflineTaskOperations: {
    saveTask: (...a: unknown[]) => saveTask(...a),
    deleteTask: vi.fn(),
    getTask: vi.fn(async () => null),
    getTasks: vi.fn(async () => []),
  },
  OfflineListOperations: {
    saveList: vi.fn(),
    deleteList: vi.fn(),
    getList: vi.fn(async () => null),
  },
  OfflineIdMappingOperations: { getRealId: vi.fn(async () => null) },
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }))
})

describe('updates queue for v1 URLs, not just legacy (task f2178a55)', () => {
  it('queues PUT /api/v1/tasks/:id — the endpoint every task edit actually uses', async () => {
    const { apiPut } = await import('@/lib/api')
    await apiPut('/api/v1/tasks/task-1', { title: 'Renamed' })

    expect(
      queueMutation,
      'a task edit made offline was dropped instead of queued',
    ).toHaveBeenCalled()
    const [type, entity, entityId] = queueMutation.mock.calls[0]
    expect({ type, entity, entityId }).toEqual({
      type: 'update',
      entity: 'task',
      entityId: 'task-1',
    })
  })

  it('queues PUT /api/v1/lists/:id', async () => {
    const { apiPut } = await import('@/lib/api')
    await apiPut('/api/v1/lists/list-1', { name: 'Renamed' })

    expect(queueMutation).toHaveBeenCalled()
    const [, entity, entityId] = queueMutation.mock.calls[0]
    expect({ entity, entityId }).toEqual({ entity: 'list', entityId: 'list-1' })
  })

  it('still queues the legacy PUT /api/tasks/:id', async () => {
    // Subtask promotion is still on the legacy route; widening must not
    // narrow.
    const { apiPut } = await import('@/lib/api')
    await apiPut('/api/tasks/task-2', { parentTaskId: null })

    expect(queueMutation).toHaveBeenCalled()
    expect(queueMutation.mock.calls[0][2]).toBe('task-2')
  })
})

describe('deletes queue for v1 URLs (task f2178a55)', () => {
  it('queues DELETE /api/v1/tasks/:id', async () => {
    const { apiDelete } = await import('@/lib/api')
    await apiDelete('/api/v1/tasks/task-3')

    expect(queueMutation).toHaveBeenCalled()
    const [type, entity, entityId] = queueMutation.mock.calls[0]
    expect({ type, entity, entityId }).toEqual({
      type: 'delete',
      entity: 'task',
      entityId: 'task-3',
    })
  })
})

describe('creates queue for v1 collections (task f2178a55)', () => {
  it('queues POST /api/v1/tasks', async () => {
    const { apiPost } = await import('@/lib/api')
    await apiPost('/api/v1/tasks', { title: 'New' })

    expect(queueMutation).toHaveBeenCalled()
    const [type, entity] = queueMutation.mock.calls[0]
    expect({ type, entity }).toEqual({ type: 'create', entity: 'task' })
  })

  it('queues POST /api/v1/tasks/:id/comments', async () => {
    const { apiPost } = await import('@/lib/api')
    await apiPost('/api/v1/tasks/task-1/comments', {
      content: 'hi',
      userId: 'u1',
    })

    expect(queueMutation).toHaveBeenCalled()
    expect(queueMutation.mock.calls[0][1]).toBe('comment')
  })
})

describe('the matcher must not swallow non-entity routes (task f2178a55)', () => {
  it('does NOT treat /api/v1/users/me/smart-tasks as a task', async () => {
    // Ends in "tasks" and is a settings endpoint. Queueing it would file a
    // settings write as a task mutation and replay it against the wrong route.
    const { apiPut } = await import('@/lib/api')
    await apiPut('/api/v1/users/me/smart-tasks', { subtaskDisplay: 'indented' })

    expect(
      queueMutation,
      'a settings write was queued as a task mutation',
    ).not.toHaveBeenCalled()
  })

  it('does NOT queue an unrelated v1 route', async () => {
    const { apiPut } = await import('@/lib/api')
    await apiPut('/api/v1/users/me', { name: 'Jon' })

    expect(queueMutation).not.toHaveBeenCalled()
  })
})
