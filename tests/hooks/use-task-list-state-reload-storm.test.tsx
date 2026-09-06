/**
 * RED for task ed1d85ba-2368-4397-b99c-e40a11c4b8d4.
 *
 * The loadData effect depended on `effectiveSession?.user` — an OBJECT.
 * next-auth hands back a fresh object on every session refresh, so an identity
 * that has not changed still produced a new reference, re-ran the effect, and
 * cost a full reload. loadData is four network round trips.
 *
 * The file already had the right shape one line away: `currentUserId` at :72 is
 * memoised on `effectiveSession?.user?.id`, and the SSE effect at :493 keys on
 * the id. Three effects did not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const seedFromCache = vi.hoisted(() => vi.fn())
const fetchSyncPayload = vi.hoisted(() => vi.fn())
const apiGet = vi.hoisted(() => vi.fn())

// Stable across renders on purpose: loadData is memoised on `toast`, so a
// fresh object per render would rebuild loadData, re-fire the effect and loop —
// a property of the mock, not of the hook.
const toastApi = vi.hoisted(() => ({ toast: () => undefined }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => toastApi }))
const listHandlers = vi.hoisted(() => ({ current: null as null | ((e: unknown) => void) }))
vi.mock('@/hooks/use-sse-subscription', () => ({
  useTaskSSEEvents: () => undefined,
  useSSESubscription: (types: readonly string[], handler: (e: unknown) => void) => {
    if (types.includes('list_member_added')) listHandlers.current = handler
  },
}))
vi.mock('@/lib/api', () => ({ apiGet }))
vi.mock('@/hooks/task-manager/load-from-cache', () => ({ seedFromCache }))
vi.mock('@/hooks/task-manager/sync-fetch', () => ({ fetchSyncPayload }))
vi.mock('@/hooks/task-manager/merge-tasks', () => ({
  mergeTasks: (_a: unknown, b: unknown) => b,
  mergeLists: (_a: unknown, b: unknown) => b,
}))
vi.mock('@/lib/image-cache', () => ({ preloadUserAvatars: vi.fn() }))
// Used by the SSE-reconnect effect.
vi.mock('@/lib/sse-manager', () => ({
  SSEManager: { onReconnection: () => () => undefined },
}))

const { useTaskListState } = await import('@/hooks/task-manager/useTaskListState')

function props(session: unknown) {
  return {
    effectiveSession: session,
    selectedListId: '',
    setSelectedListId: vi.fn(),
    setSelectedTaskId: vi.fn(),
    selectedTaskId: '',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  seedFromCache.mockResolvedValue({ tasks: [], lists: [], hasData: false })
  fetchSyncPayload.mockResolvedValue({ tasks: [], lists: [] })
  apiGet.mockResolvedValue({ ok: true, json: async () => ({}) })
})

describe('loadData is keyed on identity, not object reference (task ed1d85ba)', () => {
  it('does not reload when next-auth hands back a new object for the same user', async () => {
    const { rerender } = renderHook((p: ReturnType<typeof props>) => useTaskListState(p), {
      initialProps: props({ user: { id: 'user-1', name: 'Jon' } }),
    })

    await waitFor(() => expect(seedFromCache).toHaveBeenCalled())
    const loadsAfterMount = seedFromCache.mock.calls.length

    // Same person, different object — exactly what a session refresh produces.
    rerender(props({ user: { id: 'user-1', name: 'Jon' } }))
    rerender(props({ user: { id: 'user-1', name: 'Jon' } }))

    await new Promise((r) => setTimeout(r, 30))
    expect(seedFromCache.mock.calls.length).toBe(loadsAfterMount)
  })

  it('still reloads when the user actually changes', async () => {
    const { rerender } = renderHook((p: ReturnType<typeof props>) => useTaskListState(p), {
      initialProps: props({ user: { id: 'user-1' } }),
    })

    await waitFor(() => expect(seedFromCache).toHaveBeenCalled())
    const loadsAfterMount = seedFromCache.mock.calls.length

    rerender(props({ user: { id: 'user-2' } }))

    await waitFor(() =>
      expect(seedFromCache.mock.calls.length).toBeGreaterThan(loadsAfterMount),
    )
  })
})

describe('membership events do not fan a full reload out to everyone (task ed1d85ba)', () => {
  async function mounted(userId: string) {
    renderHook((p: ReturnType<typeof props>) => useTaskListState(p), {
      initialProps: props({ user: { id: userId } }),
    })
    await waitFor(() => expect(seedFromCache).toHaveBeenCalled())
    return seedFromCache.mock.calls.length
  }

  it('does not reload for an existing member when someone ELSE is added', async () => {
    const before = await mounted('user-1')

    // broadcastToUsers sends this to EVERY member of the list, not just the
    // person added — so adding five people used to cost five full reloads each.
    act(() => listHandlers.current?.({
      type: 'list_member_added',
      data: { listId: 'l1', listName: 'Team', inviterName: 'Jon', newMemberId: 'someone-else' },
    }))

    await new Promise((r) => setTimeout(r, 30))
    expect(seedFromCache.mock.calls.length).toBe(before)
  })

  it('still reloads for the person actually added, who gains a list they could not see', async () => {
    const before = await mounted('user-1')

    act(() => listHandlers.current?.({
      type: 'list_member_added',
      data: { listId: 'l1', listName: 'Team', inviterName: 'Jon', newMemberId: 'user-1' },
    }))

    await waitFor(() => expect(seedFromCache.mock.calls.length).toBeGreaterThan(before))
  })

  it('reads the v1 payload shape too, which nests the member', async () => {
    const before = await mounted('user-1')

    // /api/v1/lists/[id]/members sends `member: { id }`; the legacy route sends
    // `newMemberId`. Reading only one shape silently ignores the other.
    act(() => listHandlers.current?.({
      type: 'list_member_added',
      data: { listId: 'l1', member: { id: 'user-1', role: 'member' } },
    }))

    await waitFor(() => expect(seedFromCache.mock.calls.length).toBeGreaterThan(before))
  })

  it('does not reload for a role change that is not yours', async () => {
    const before = await mounted('user-1')

    act(() => listHandlers.current?.({
      type: 'list_member_role_changed',
      data: { listId: 'l1', listName: 'Team', memberId: 'someone-else', newRole: 'admin' },
    }))

    await new Promise((r) => setTimeout(r, 30))
    expect(seedFromCache.mock.calls.length).toBe(before)
  })
})
