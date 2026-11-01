/**
 * AWTD-1451 step 1 — a public/featured list the user does not own and is not
 * a member of must get its tasks from `GET /api/v1/tasks?listId=`, not from the
 * global synced read.
 *
 * Today the view draws such a list by filtering the main task cache
 * (`scopeTasksToList` → `tasks.filter(inList(id))`), which is filled by the
 * no-`listId` read. That read ORs in every PUBLIC list in the database — the
 * perf problem AWTD-1451 exists to fix — and dropping that clause (step 2)
 * would open these lists empty. These tests pin that the view no longer
 * depends on it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import type { Task, TaskList } from '@/types/task'
import { scopeTasksToList } from '@/lib/task-list-scope'

const seedFromCache = vi.hoisted(() => vi.fn())
const fetchSyncPayload = vi.hoisted(() => vi.fn())
const apiGet = vi.hoisted(() => vi.fn())
const cachedListTasks = vi.hoisted(() => new Map<string, unknown[]>())

const toastApi = vi.hoisted(() => ({ toast: () => undefined }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => toastApi }))
vi.mock('@/hooks/use-sse-subscription', () => ({
  useTaskSSEEvents: () => undefined,
  useSSESubscription: () => undefined,
}))
vi.mock('@/lib/api', () => ({ apiGet }))
vi.mock('@/hooks/task-manager/load-from-cache', () => ({ seedFromCache }))
vi.mock('@/hooks/task-manager/sync-fetch', () => ({ fetchSyncPayload }))
vi.mock('@/lib/image-cache', () => ({ preloadUserAvatars: vi.fn() }))
vi.mock('@/lib/sse-manager', () => ({
  SSEManager: { onReconnection: () => () => undefined },
}))
vi.mock('@/lib/offline-db', () => ({
  OfflinePublicTaskOperations: {
    getListTasks: async (listId: string) => cachedListTasks.get(listId) ?? [],
    replaceListTasks: async (listId: string, tasks: unknown[]) => { cachedListTasks.set(listId, tasks) },
  },
}))

const { useTaskListState } = await import('@/hooks/task-manager/useTaskListState')
type HookResult = ReturnType<typeof useTaskListState>

const task = (id: string, listIds: string[]) =>
  ({ id, title: id, lists: listIds.map(l => ({ id: l, name: l })) }) as unknown as Task

const OWN_LIST = { id: 'mine', name: 'Mine', ownerId: 'user-1' } as unknown as TaskList
const PUBLIC_TASK = task('p1', ['pub-1'])

const current: { hook: HookResult | null } = { hook: null }

function Harness({ selectedListId }: { selectedListId: string }) {
  const hook = useTaskListState({
    effectiveSession: { user: { id: 'user-1' } },
    selectedListId,
    setSelectedListId: vi.fn(),
    setSelectedTaskId: vi.fn(),
    selectedTaskId: '',
  })
  React.useEffect(() => { current.hook = hook })
  return null
}

const listFetches = () =>
  apiGet.mock.calls.map(([url]) => String(url)).filter(url => url.startsWith('/api/v1/tasks?listId='))

const json = (body: unknown) => ({ ok: true, json: async () => body })

/** What the selected list's view starts from — the same call the controller makes. */
const viewOf = (listId: string) =>
  scopeTasksToList(current.hook!.finalTasks, listId, current.hook!.lists.find(l => l.id === listId), 'user-1')
    .map(t => t.id)

beforeEach(() => {
  vi.clearAllMocks()
  cachedListTasks.clear()
  current.hook = null
  seedFromCache.mockResolvedValue({ tasks: [], lists: [], hasData: false })
  // The global read carries NONE of the public list's tasks — what step 2 will make true.
  fetchSyncPayload.mockResolvedValue({
    tasks: [task('a', ['mine'])],
    lists: [OWN_LIST],
    deletedTaskIds: [],
    deletedListIds: [],
    tasksIsDelta: false,
    listsIsDelta: false,
    truncated: false,
  })
  apiGet.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/tasks?listId=pub-1')) {
      return json({ tasks: [PUBLIC_TASK], meta: { total: 1, limit: 1000, offset: 0 } })
    }
    return json({})
  })
})

describe('AWTD-1451 step 1: a foreign public list fetches its tasks by ?listId=', () => {
  it('shows the list\'s tasks even when the global read contains none of them', async () => {
    render(<Harness selectedListId="pub-1" />)

    await waitFor(() => expect(viewOf('pub-1')).toEqual(['p1']))
    expect(listFetches()).toHaveLength(1)
    expect(listFetches()[0]).toContain('listId=pub-1')
  })

  it('keeps them through a later full reload that again omits them', async () => {
    render(<Harness selectedListId="pub-1" />)
    await waitFor(() => expect(viewOf('pub-1')).toEqual(['p1']))

    await act(async () => { await current.hook!.loadData() })

    expect(viewOf('pub-1')).toEqual(['p1'])
    // The owned list's tasks are still the global read's.
    expect(viewOf('mine')).toEqual(['a'])
  })

  it('makes no per-list request for a list the user owns or belongs to', async () => {
    render(<Harness selectedListId="mine" />)

    await waitFor(() => expect(viewOf('mine')).toEqual(['a']))
    // Let any effect that would fetch run.
    await act(async () => { await Promise.resolve() })
    expect(listFetches()).toHaveLength(0)
  })

  it('makes no per-list request for a system view', async () => {
    render(<Harness selectedListId="today" />)

    await waitFor(() => expect(current.hook!.lists).toHaveLength(1))
    await act(async () => { await Promise.resolve() })
    expect(listFetches()).toHaveLength(0)
  })

  it('caches what it fetched and falls back to it when the fetch fails (offline)', async () => {
    cachedListTasks.set('pub-1', [PUBLIC_TASK])
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/v1/tasks?listId=')) throw new TypeError('Failed to fetch')
      return json({})
    })

    render(<Harness selectedListId="pub-1" />)

    await waitFor(() => expect(viewOf('pub-1')).toEqual(['p1']))
  })

  it('writes a successful fetch to the offline cache', async () => {
    render(<Harness selectedListId="pub-1" />)

    await waitFor(() => expect(cachedListTasks.get('pub-1')).toEqual([PUBLIC_TASK]))
  })
})
