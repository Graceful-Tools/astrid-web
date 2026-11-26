/**
 * ADEV-301 — a second, different change to the same task within 500ms (rename,
 * then complete) must not be dropped by the task_updated dedup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import type { Task } from '@/types/task'

const seedFromCache = vi.hoisted(() => vi.fn())
const fetchSyncPayload = vi.hoisted(() => vi.fn())
const sse = vi.hoisted(() => ({ handlers: {} as Record<string, (e: unknown) => void> }))

const toastApi = vi.hoisted(() => ({ toast: () => undefined }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => toastApi }))
vi.mock('@/hooks/use-sse-subscription', () => ({
  useTaskSSEEvents: (handlers: Record<string, (e: unknown) => void>) => { sse.handlers = handlers },
  useSSESubscription: () => undefined,
}))
vi.mock('@/lib/api', () => ({ apiGet: vi.fn() }))
vi.mock('@/hooks/task-manager/load-from-cache', () => ({ seedFromCache }))
vi.mock('@/hooks/task-manager/sync-fetch', () => ({ fetchSyncPayload }))
vi.mock('@/lib/image-cache', () => ({ preloadUserAvatars: vi.fn() }))
vi.mock('@/lib/sse-manager', () => ({
  SSEManager: { onReconnection: () => () => undefined },
}))

const { useTaskListState } = await import('@/hooks/task-manager/useTaskListState')
type HookResult = ReturnType<typeof useTaskListState>
const current: { hook: HookResult | null } = { hook: null }

function Harness() {
  const hook = useTaskListState({
    effectiveSession: { user: { id: 'user-1' } },
    selectedListId: 'mine',
    setSelectedListId: vi.fn(),
    setSelectedTaskId: vi.fn(),
    selectedTaskId: '',
  })
  React.useEffect(() => { current.hook = hook })
  return null
}

const base = { id: 't1', title: 'Old', completed: false, lists: [{ id: 'mine', name: 'Mine' }] } as unknown as Task
const find = () => current.hook!.tasks.find(t => t.id === 't1')

beforeEach(() => {
  vi.clearAllMocks()
  current.hook = null
  seedFromCache.mockResolvedValue({ tasks: [], lists: [], hasData: false })
  fetchSyncPayload.mockResolvedValue({
    tasks: [base], lists: [], deletedTaskIds: [], deletedListIds: [],
    tasksIsDelta: false, listsIsDelta: false, truncated: false,
  })
})

describe('ADEV-301: task_updated dedup keeps distinct changes', () => {
  it('applies a completion that follows a rename within 500ms', async () => {
    render(<Harness />)
    await waitFor(() => expect(current.hook).not.toBeNull())
    act(() => { current.hook!.setTasks([base]) })
    await waitFor(() => expect(find()?.title).toBe('Old'))

    act(() => { sse.handlers.onTaskUpdated({ v1Task: { id: 't1', title: 'New' } }) })
    act(() => { sse.handlers.onTaskUpdated({ v1Task: { id: 't1', completed: true } }) })

    await waitFor(() => expect(find()?.title).toBe('New'))
    expect(find()?.completed).toBe(true)
  })
})
