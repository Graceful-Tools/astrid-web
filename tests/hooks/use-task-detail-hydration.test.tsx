/**
 * @vitest-environment jsdom
 *
 * AWTD-1242 — one read of `/api/v1/tasks/{id}` when the detail pane opens.
 *
 * The merge and the fetch are tested without React in
 * tests/hooks/task-detail-hydrate.test.ts. What needs a React tree is WHEN the
 * read happens, and every case here is one that costs something real if it goes
 * wrong: a read per render would put a request on every keystroke in the pane;
 * a remembered failure would leave a task unhydrated for the rest of the
 * session; a read for an optimistic `temp-` id is a guaranteed 404; and a cache
 * write that replaced rather than merged would drop whatever the cached row
 * carried and this response does not.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const fetchTaskDetail = vi.fn()
const getTask = vi.fn()
const setTask = vi.fn()

vi.mock('@/hooks/task-manager/detail-hydrate', async () => {
  const actual = await vi.importActual<
    typeof import('@/hooks/task-manager/detail-hydrate')
  >('@/hooks/task-manager/detail-hydrate')
  return {
    ...actual,
    fetchTaskDetail: (...args: unknown[]) => fetchTaskDetail(...args),
  }
})

vi.mock('@/lib/cache-manager', () => ({
  CacheManager: {
    getTask: (...args: unknown[]) => getTask(...args),
    setTask: (...args: unknown[]) => setTask(...args),
  },
}))

import { useTaskDetailHydration } from '@/hooks/task-manager/useTaskDetailHydration'
import type { Task } from '@/types/task'

const hydrated = {
  id: 't1',
  title: 'Pay the invoice',
  secureFiles: [{ id: 'f1' }],
} as unknown as Task

beforeEach(() => {
  vi.clearAllMocks()
  getTask.mockResolvedValue(null)
  setTask.mockResolvedValue(undefined)
})

function mount(selectedTaskId: string, setTasks = vi.fn()) {
  return renderHook(
    ({ id }: { id: string }) => useTaskDetailHydration({ selectedTaskId: id, setTasks }),
    { initialProps: { id: selectedTaskId } }
  )
}

describe('useTaskDetailHydration (AWTD-1242)', () => {
  it('reads the opened task once and merges it into rendered state', async () => {
    fetchTaskDetail.mockResolvedValue(hydrated)
    const setTasks = vi.fn()

    mount('t1', setTasks)

    await waitFor(() => expect(setTasks).toHaveBeenCalledTimes(1))
    expect(fetchTaskDetail).toHaveBeenCalledWith('t1')

    // The updater is what gets handed to React; apply it to prove the merge.
    const updater = setTasks.mock.calls[0][0] as (prev: Task[]) => Task[]
    const next = updater([{ id: 't1', title: 'Pay the invoice' } as Task])
    expect(next[0].secureFiles).toHaveLength(1)
  })

  it('does not read again when the same task is re-rendered', async () => {
    fetchTaskDetail.mockResolvedValue(hydrated)

    const { rerender } = mount('t1')
    await waitFor(() => expect(fetchTaskDetail).toHaveBeenCalledTimes(1))

    rerender({ id: 't1' })
    rerender({ id: 't1' })

    expect(fetchTaskDetail).toHaveBeenCalledTimes(1)
  })

  it('reads each task once when the pane moves between tasks', async () => {
    fetchTaskDetail.mockResolvedValue(hydrated)

    const { rerender } = mount('t1')
    await waitFor(() => expect(fetchTaskDetail).toHaveBeenCalledTimes(1))

    rerender({ id: 't2' })
    await waitFor(() => expect(fetchTaskDetail).toHaveBeenCalledTimes(2))
    expect(fetchTaskDetail).toHaveBeenLastCalledWith('t2')
  })

  it('retries after a failed read rather than remembering the failure', async () => {
    fetchTaskDetail.mockResolvedValueOnce(null).mockResolvedValue(hydrated)

    const { rerender } = mount('t1')
    await waitFor(() => expect(fetchTaskDetail).toHaveBeenCalledTimes(1))

    rerender({ id: '' })
    rerender({ id: 't1' })

    await waitFor(() => expect(fetchTaskDetail).toHaveBeenCalledTimes(2))
  })

  it('reads nothing when no pane is open', () => {
    mount('')

    expect(fetchTaskDetail).not.toHaveBeenCalled()
  })

  it('reads nothing for an optimistic task that has no server id yet', () => {
    mount('temp-1760000000')

    expect(fetchTaskDetail).not.toHaveBeenCalled()
  })

  it('writes through to the cache, merged onto the cached row', async () => {
    fetchTaskDetail.mockResolvedValue(hydrated)
    getTask.mockResolvedValue({
      data: { id: 't1', title: 'Pay the invoice', description: 'cached earlier' },
    })

    mount('t1')

    await waitFor(() => expect(setTask).toHaveBeenCalledTimes(1))
    const written = setTask.mock.calls[0][0] as Task
    expect(written.secureFiles).toHaveLength(1)
    expect(written.description).toBe('cached earlier')
  })

  it('still updates rendered state when the cache read throws', async () => {
    fetchTaskDetail.mockResolvedValue(hydrated)
    getTask.mockRejectedValue(new Error('IndexedDB unavailable'))
    const setTasks = vi.fn()

    mount('t1', setTasks)

    await waitFor(() => expect(setTasks).toHaveBeenCalledTimes(1))
    expect(setTask).not.toHaveBeenCalled()
  })
})
