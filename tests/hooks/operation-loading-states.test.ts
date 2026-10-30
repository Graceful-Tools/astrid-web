/**
 * Loading states exposed by the real useTaskOperations hook.
 *
 * Each operation flags itself while in flight — create globally, update and
 * delete per task id — and clears the flag in `finally`, so a failed request
 * cannot leave a spinner stuck. This file used to assert on hand-built
 * objects shaped like the hook's return value (AWTD-1422).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const apiPost = vi.hoisted(() => vi.fn())
const apiDelete = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/lib/api', () => ({ apiPost, apiPut: vi.fn(), apiDelete }))
vi.mock('@/lib/task-sounds', () => ({
  playTaskCreateSound: vi.fn(),
  playTaskCompleteSound: vi.fn(),
}))
vi.mock('@/lib/offline-sync', () => ({
  isOfflineMode: vi.fn(() => false),
  OfflineSyncManager: { queueMutation: vi.fn() },
}))
vi.mock('@/lib/offline-db', () => ({
  OfflineTaskOperations: { saveTask: vi.fn(), getTask: vi.fn(), deleteTask: vi.fn() },
  OfflineListOperations: {},
}))

import { useTaskOperations } from '@/hooks/useTaskOperations'

/** A promise the test settles by hand, to observe the in-flight state. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const taskResponse = (task: Record<string, unknown>) =>
  new Response(JSON.stringify({ task }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useTaskOperations loading states', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useTaskOperations())

    expect(result.current.isCreating).toBe(false)
    expect(result.current.isUpdating).toEqual({})
    expect(result.current.isDeleting).toEqual({})
    expect(result.current.isAnyOperationPending).toBe(false)
  })

  it('flags isCreating while a create is in flight and clears it after', async () => {
    const request = deferred<Response>()
    apiPost.mockReturnValueOnce(request.promise)
    const { result } = renderHook(() => useTaskOperations())

    let created: Promise<unknown>
    act(() => {
      created = result.current.createTask({ title: 'New task' })
    })
    await waitFor(() => expect(result.current.isCreating).toBe(true))
    expect(result.current.isAnyOperationPending).toBe(true)

    await act(async () => {
      request.resolve(taskResponse({ id: 't1', title: 'New task', completed: false }))
      await created
    })
    expect(result.current.isCreating).toBe(false)
    expect(result.current.isAnyOperationPending).toBe(false)
  })

  it('clears isCreating when the create fails', async () => {
    apiPost.mockRejectedValueOnce(new Error('Operation failed'))
    const onError = vi.fn()
    const { result } = renderHook(() => useTaskOperations({ onError }))

    await act(async () => {
      expect(await result.current.createTask({ title: 'New task' })).toBeNull()
    })

    expect(onError).toHaveBeenCalledWith('Operation failed')
    expect(result.current.isCreating).toBe(false)
  })

  it('tracks deletes per task id', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    apiDelete.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useTaskOperations())

    let p1: Promise<boolean>, p2: Promise<boolean>
    act(() => {
      p1 = result.current.deleteTask('task-1')
      p2 = result.current.deleteTask('task-2')
    })
    await waitFor(() => expect(result.current.isDeleting).toEqual({ 'task-1': true, 'task-2': true }))
    expect(result.current.isAnyOperationPending).toBe(true)

    await act(async () => {
      first.resolve(new Response(null, { status: 204 }))
      await p1
    })
    expect(result.current.isDeleting).toEqual({ 'task-1': false, 'task-2': true })
    expect(result.current.isAnyOperationPending).toBe(true)

    await act(async () => {
      second.reject(new Error('Delete failed'))
      await p2
    })
    expect(result.current.isDeleting).toEqual({ 'task-1': false, 'task-2': false })
    expect(result.current.isAnyOperationPending).toBe(false)
  })
})
