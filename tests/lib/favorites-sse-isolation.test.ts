/**
 * Favorites SSE isolation.
 *
 * isFavorite/favoriteOrder are per user, but a `list_updated` event goes to
 * every member. The client handler in useTaskListState must take the shared
 * fields from the event and keep this viewer's own favorite state.
 *
 * The server half — not broadcasting the caller's favorite flags — is covered
 * against the real code in tests/lib/list-manual-order.test.ts ("does not
 * broadcast this caller's favorite flags to everyone").
 *
 * This file used to apply an in-file copy of the merge to literals; it now
 * drives the real hook (AWTD-1422).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const seedFromCache = vi.hoisted(() => vi.fn())
const fetchSyncPayload = vi.hoisted(() => vi.fn())
const apiGet = vi.hoisted(() => vi.fn())

// Stable across renders: loadData is memoised on `toast`.
const toastApi = vi.hoisted(() => ({ toast: () => undefined }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => toastApi }))
const listHandlers = vi.hoisted(() => ({ current: null as null | ((e: unknown) => void) }))
vi.mock('@/hooks/use-sse-subscription', () => ({
  useTaskSSEEvents: () => undefined,
  useSSESubscription: (types: readonly string[], handler: (e: unknown) => void) => {
    if (types.includes('list_updated')) listHandlers.current = handler
  },
}))
vi.mock('@/lib/api', () => ({ apiGet }))
vi.mock('@/hooks/task-manager/load-from-cache', () => ({ seedFromCache }))
vi.mock('@/hooks/task-manager/sync-fetch', () => ({ fetchSyncPayload }))
vi.mock('@/lib/image-cache', () => ({ preloadUserAvatars: vi.fn() }))
vi.mock('@/lib/sse-manager', () => ({
  SSEManager: { onReconnection: () => () => undefined },
}))

const { useTaskListState } = await import('@/hooks/task-manager/useTaskListState')

// User B's lists, as their own GET returned them
const USER_B_LISTS = [
  { id: 'list-1', name: 'Shared Project', color: '#old', isFavorite: true, favoriteOrder: 3 },
  { id: 'list-2', name: 'Another List', color: '#222', isFavorite: false, favoriteOrder: null },
]

async function mountAsUserB() {
  const hook = renderHook(() =>
    useTaskListState({
      effectiveSession: { user: { id: 'user-B' } },
      selectedListId: '',
      setSelectedListId: vi.fn(),
      setSelectedTaskId: vi.fn(),
      selectedTaskId: '',
    } as never)
  )
  await waitFor(() => expect(hook.result.current.lists).toHaveLength(2))
  return hook
}

function listUpdated(data: Record<string, unknown>) {
  act(() => listHandlers.current?.({ type: 'list_updated', data }))
}

beforeEach(() => {
  vi.clearAllMocks()
  listHandlers.current = null
  seedFromCache.mockResolvedValue({ tasks: [], lists: [], hasData: false })
  fetchSyncPayload.mockResolvedValue({
    tasks: [],
    lists: USER_B_LISTS,
    tasksIsDelta: false,
    listsIsDelta: false,
    deletedTaskIds: [],
    deletedListIds: [],
  })
  apiGet.mockResolvedValue({ ok: true, json: async () => ({}) })
})

describe('Favorites SSE isolation — client list_updated handler', () => {
  it('applies shared fields and keeps the local favorite when the event has none', async () => {
    const { result } = await mountAsUserB()

    listUpdated({ id: 'list-1', name: 'Renamed Project', color: '#new' })

    const list1 = result.current.lists.find(l => l.id === 'list-1')!
    expect(list1.name).toBe('Renamed Project')
    expect(list1.color).toBe('#new')
    expect(list1.isFavorite).toBe(true)
    expect(list1.favoriteOrder).toBe(3)
  })

  it('preserves isFavorite=false too', async () => {
    const { result } = await mountAsUserB()

    listUpdated({ id: 'list-2', name: 'Renamed' })

    const list2 = result.current.lists.find(l => l.id === 'list-2')!
    expect(list2.name).toBe('Renamed')
    expect(list2.isFavorite).toBe(false)
    expect(list2.favoriteOrder).toBeNull()
  })

  it("ignores another user's favorite fields if an event still carries them", async () => {
    const { result } = await mountAsUserB()

    // User A un-favorited it for themselves; their flags must not leak to B
    listUpdated({ id: 'list-1', name: 'Renamed Project', isFavorite: false, favoriteOrder: null })

    const list1 = result.current.lists.find(l => l.id === 'list-1')!
    expect(list1.name).toBe('Renamed Project')
    expect(list1.isFavorite).toBe(true)
    expect(list1.favoriteOrder).toBe(3)
  })

  it('leaves other lists untouched', async () => {
    const { result } = await mountAsUserB()

    listUpdated({ id: 'list-1', name: 'Renamed Project' })

    expect(result.current.lists.find(l => l.id === 'list-2')).toEqual(USER_B_LISTS[1])
  })
})
