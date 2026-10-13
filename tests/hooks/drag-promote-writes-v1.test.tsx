/**
 * @vitest-environment jsdom
 *
 * RED for AWTD-1246 — "move out of subtask" was the last caller of the legacy
 * task route.
 *
 * `/api/tasks/[id]` is quiet in production (the legacy census reports it SAFE:
 * one hit ever, none inside the 28-day window), but it could not be deleted
 * while this call site existed — `legacy-api-coverage.ts` put it in
 * `callers-remain`, with exactly one caller: the drag-promotion write in
 * `useTaskDragDrop`. The legacy `/api` sunset is 2026-11-01 (epic 9dedd8aa).
 *
 * Two things change with the path, and the second one matters more:
 *
 *   - The legacy route's PUT **replaces** the task and clears an absent due
 *     date, which is why the old call spread the whole task into the body. v1's
 *     PUT has PATCH semantics — only what is sent is touched — so the body is
 *     now the one field this drag actually changes. Sending a whole stale task
 *     object to a PATCH endpoint is how a drag quietly reverts an edit made in
 *     another tab.
 *   - The response is the v1 envelope rather than the bare task. This path only
 *     reads `ok` and, on failure, the body as text, so nothing has to unwrap —
 *     and a test says so, because someone will eventually want the task back
 *     from this call and must reach for `unwrapTask` rather than `body.id`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const apiPut = vi.fn()
const apiPost = vi.fn()

vi.mock('@/lib/api', () => ({
  apiPut: (...args: unknown[]) => apiPut(...args),
  apiPost: (...args: unknown[]) => apiPost(...args),
}))

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

import { useTaskDragDrop } from '@/hooks/task-manager/useTaskDragDrop'
import type { Task } from '@/types/task'

const subtask = {
  id: 'child',
  title: 'Buy the stamps',
  parentTaskId: 'parent',
  dueDateTime: new Date('2026-10-20T16:00:00.000Z'),
} as unknown as Task

function mount(tasks: Task[] = [subtask]) {
  return renderHook(() =>
    useTaskDragDrop({
      tasks,
      lists: [],
      selectedListId: 'list-1',
      currentUserId: 'user-1',
      manualSortActive: false,
      myTasksManualSortOrder: undefined,
      setMyTasksManualSortOrder: vi.fn(),
      setTasks: vi.fn(),
      setLists: vi.fn(),
      setSelectedTaskId: vi.fn(),
      newTaskOperations: { current: null },
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  apiPut.mockResolvedValue({ ok: true, status: 200, json: async () => ({ task: subtask }) })
})

describe('drag promotion writes through v1 (AWTD-1246)', () => {
  it('sends the unnesting write to the v1 task route', async () => {
    const { result } = mount()

    act(() => result.current.handleTaskDragStart('child'))
    await act(async () => {
      await result.current.handleTaskDropOnPromoteTarget()
    })

    expect(apiPut).toHaveBeenCalledTimes(1)
    expect(apiPut.mock.calls[0][0]).toBe('/api/v1/tasks/child')
  })

  it('never calls the legacy task route', () => {
    // The whole point: `/api/tasks/[id]` has no callers left, so AWTD-839 can
    // delete it.
    const { result } = mount()

    act(() => result.current.handleTaskDragStart('child'))

    return act(async () => {
      await result.current.handleTaskDropOnPromoteTarget()
    }).then(() => {
      for (const call of apiPut.mock.calls) {
        expect(String(call[0])).not.toMatch(/^\/api\/tasks\//)
      }
    })
  })

  it('sends only the field the drag changes, not the whole task', async () => {
    // v1's PUT is a PATCH: an absent field is untouched. Spreading a stale task
    // in would write every field back as the dragging tab last saw it.
    const { result } = mount()

    act(() => result.current.handleTaskDragStart('child'))
    await act(async () => {
      await result.current.handleTaskDropOnPromoteTarget()
    })

    expect(apiPut.mock.calls[0][1]).toEqual({ parentTaskId: null })
  })

  it('reports a failed write rather than leaving the row promoted', async () => {
    apiPut.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Parent task not found',
    })
    const setTasks = vi.fn()

    const { result } = renderHook(() =>
      useTaskDragDrop({
        tasks: [subtask],
        lists: [],
        selectedListId: 'list-1',
        currentUserId: 'user-1',
        manualSortActive: false,
        myTasksManualSortOrder: undefined,
        setMyTasksManualSortOrder: vi.fn(),
        setTasks,
        setLists: vi.fn(),
        setSelectedTaskId: vi.fn(),
        newTaskOperations: { current: null },
      })
    )

    act(() => result.current.handleTaskDragStart('child'))
    await act(async () => {
      await result.current.handleTaskDropOnPromoteTarget()
    })

    // Optimistic clear, then the rollback — the row goes back under its parent.
    expect(setTasks).toHaveBeenCalledTimes(2)
    const rollback = setTasks.mock.calls[1][0] as (prev: Task[]) => Task[]
    expect(rollback([{ ...subtask, parentTaskId: null }])[0].parentTaskId).toBe('parent')
  })
})
