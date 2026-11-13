/**
 * AWTD-1635: creating a list from the sidebar sometimes crashed the app.
 *
 * POST /api/v1/lists answers `{ list, meta }`. handleCreateList appended that
 * whole body to `lists` as if it were the list, so the sidebar held an entry
 * with no id. The reload right after it, on a full merge, ran
 * `list.id.startsWith('temp-')` on that entry and threw, which took the page to
 * "Something went wrong". (It also never selected the new list: `newList.id`
 * was undefined.)
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { mergeLists } from '@/hooks/task-manager/merge-tasks'
import type { TaskList } from '@/types/task'

const h = vi.hoisted(() => {
  // The controller reads its session hook from here when set (it require()s
  // next-auth otherwise, which vi.mock cannot reach).
  ;(window as unknown as Record<string, unknown>).__TEST_USE_SESSION__ = () => ({
    data: { user: { id: 'u1', email: 'u1@example.com' } },
    status: 'authenticated',
  })
  return {
  lists: [] as Array<Record<string, unknown>>,
  setSelectedListId: null as unknown as ReturnType<typeof vi.fn>,
  apiPost: null as unknown as (...args: unknown[]) => Promise<Response>,
  }
})

function stub(base: Record<string, unknown>) {
  return new Proxy(base, {
    get(target, key) {
      if (key in target) return target[key as string]
      if (typeof key === 'symbol') return undefined
      return vi.fn()
    },
  })
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/hooks/useMyTasksPreferences', () => ({ useMyTasksPreferences: () => stub({}) }))
vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({}) }))
vi.mock('@/hooks/use-optimistic-list-info', () => ({ useOptimisticListInfo: () => ({ currentListInfo: null }) }))
vi.mock('@/hooks/use-task-search', () => ({ useTaskSearch: () => stub({ results: [], isSearching: false }) }))
vi.mock('@/hooks/useFilterState', () => ({
  useFilterState: () => stub({ filters: { search: '', completed: 'default', priority: [], assignee: [], dueDate: 'all' } }),
}))
vi.mock('@/hooks/useTaskOperations', () => ({ useTaskOperations: () => stub({}) }))
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  apiPost: (...args: unknown[]) => h.apiPost(...args),
}))
vi.mock('@/hooks/task-manager', async (orig) => {
  const actual = await orig<typeof import('@/hooks/task-manager')>()
  return {
    ...actual,
    useTaskPaneState: () => stub({}),
    useTaskSelection: () => stub({ selectedTaskIds: new Set() }),
    useTaskDragDrop: () => stub({}),
    useTaskNavigation: () => stub({ selectedListId: 'my-tasks', setSelectedListId: h.setSelectedListId }),
    useTaskListState: () =>
      stub({
        tasks: [],
        lists: h.lists,
        publicLists: [],
        finalTasks: [],
        loading: false,
        setLists: (updater: unknown) => {
          h.lists = typeof updater === 'function' ? (updater as (p: typeof h.lists) => typeof h.lists)(h.lists) : (updater as typeof h.lists)
        },
        // The reload after a create: a full (non-delta) merge with the server's lists.
        loadData: async () => {
          h.lists = mergeLists(h.lists as unknown as TaskList[], [EXISTING, CREATED] as unknown as TaskList[], {
            isDelta: false,
            deletedIds: [],
          }) as unknown as typeof h.lists
        },
      }),
  }
})

const EXISTING = { id: 'list-existing', name: 'Existing' }
const CREATED = { id: 'list-created', name: 'Groceries', taskCount: 0 }

import { useTaskManagerController } from '@/hooks/useTaskManagerController'

describe('handleCreateList with the v1 envelope (AWTD-1635)', () => {
  beforeEach(() => {
    h.lists = [EXISTING]
    h.setSelectedListId = vi.fn()
    h.apiPost = vi.fn(async () =>
      new Response(JSON.stringify({ list: CREATED, meta: { apiVersion: 'v1', authSource: 'session' } }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  it('adds the list itself (not the envelope), survives the reload, and selects it', async () => {
    const { result } = renderHook(() => useTaskManagerController({} as never))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () => {
      await result.current.handleCreateList({ name: 'Groceries', description: '', memberEmails: [] })
    })

    // The reload's full merge must not have thrown into the catch.
    const errors = consoleError.mock.calls.filter((call) => call[0] === 'Error creating list:')
    expect(errors.map((call) => String(call[1]))).toEqual([])
    consoleError.mockRestore()
    expect(h.lists.every((list) => typeof list.id === 'string')).toBe(true)
    expect(h.lists.map((list) => list.id)).toEqual(['list-existing', 'list-created'])
    expect(h.setSelectedListId).toHaveBeenCalledWith('list-created')
  })

  it('still accepts the bare list the offline queue returns', async () => {
    h.apiPost = vi.fn(async () =>
      new Response(JSON.stringify({ name: 'Groceries', id: 'temp-1' }), { status: 201 }),
    )
    const { result } = renderHook(() => useTaskManagerController({} as never))
    await act(async () => {
      await result.current.handleCreateList({ name: 'Groceries', description: '', memberEmails: [] })
    })
    expect(h.setSelectedListId).toHaveBeenCalledWith('temp-1')
    // A temp list survives a full merge until the queued create syncs.
    expect(h.lists.map((list) => list.id)).toContain('temp-1')
  })
})
