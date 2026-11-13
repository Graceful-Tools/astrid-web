/**
 * AWTD-1631: renaming a task offline made its row vanish from the list.
 *
 * The detail pane's edit goes out as a whole-task body (lib/tasks/v1-task-update-body.ts):
 * every field, `listIds` instead of `lists`. Offline, lib/api.ts queues it and answers
 * in the server's place. With the task in IndexedDB it answers with the cached task
 * plus the edit. Without it, it echoed the request body — which carries the task's
 * `id`, so unwrapTask took it for the task, and the controller swapped the row for an
 * object with no `lists`. A list view keeps only tasks in that list, so the row went.
 *
 * Whether IndexedDB held the task yet was a race with the cache write after the list
 * loaded, which is why the e2e "Offline round trip (AWTD-1417)" failed some runs only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { v1TaskUpdateBody } from '@/lib/tasks/v1-task-update-body'
import { unwrapTask } from '@/lib/v1-response'

const getTask = vi.fn()

vi.mock('@/lib/offline-sync', () => ({
  OfflineSyncManager: { queueMutation: vi.fn() },
  isOfflineMode: () => true,
}))

vi.mock('@/lib/offline-db', () => ({
  OfflineTaskOperations: {
    saveTask: vi.fn(),
    deleteTask: vi.fn(),
    getTask: (...a: unknown[]) => getTask(...a),
    getTasks: vi.fn(async () => []),
  },
  OfflineListOperations: { saveList: vi.fn(), deleteList: vi.fn(), getList: vi.fn(async () => null) },
  OfflineIdMappingOperations: { getRealId: vi.fn(async () => null) },
}))

const original = {
  id: 'task-1',
  title: 'Offline task',
  lists: [{ id: 'list-1', name: 'Offline list' }],
  assignee: null,
}
const renamed = { ...original, title: 'Offline task (offline)' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
})

describe('an offline task edit answers without pretending to be the task (AWTD-1631)', () => {
  it('does not hand back a list-less task when IndexedDB has no copy', async () => {
    getTask.mockResolvedValue(undefined)
    const { apiPut } = await import('@/lib/api')

    const response = await apiPut(`/api/v1/tasks/${original.id}`, v1TaskUpdateBody(renamed, original))
    const echoed = unwrapTask<{ id: string; lists?: unknown[] }>(await response.json())

    // Either no task at all (the caller keeps its optimistic copy) or one that still has its lists.
    if (echoed) expect(echoed.lists).toEqual(original.lists)
    expect(response.ok).toBe(true)
  })

  it('answers with the cached task plus the edit when IndexedDB has it', async () => {
    getTask.mockResolvedValue(original)
    const { apiPut } = await import('@/lib/api')

    const response = await apiPut(`/api/v1/tasks/${original.id}`, v1TaskUpdateBody(renamed, original))
    const echoed = unwrapTask<{ id: string; title: string; lists?: unknown[] }>(await response.json())

    expect(echoed?.title).toBe(renamed.title)
    expect(echoed?.lists).toEqual(original.lists)
  })
})
