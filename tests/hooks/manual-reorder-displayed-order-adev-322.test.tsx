/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-322: a manual reorder is committed from the order the list DRAWS, not from the order of the
 * `tasks` array.
 *
 * A manual list with no saved order draws its tasks newest first (completeManualOrder). The commit
 * used to start from `tasks` as they sat in state, which is whatever order the data arrived in:
 * the network's, or IndexedDB's. Dragging the bottom row above the top row then saved an order
 * that put the dragged task somewhere the person never dropped it, and the row jumped. It only
 * showed when the data arrived in an order other than the drawn one, i.e. with different timing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTaskDragDrop } from '@/hooks/task-manager/useTaskDragDrop'
import type { Task, TaskList } from '@/types/task'

const apiPost = vi.fn()
vi.mock('@/lib/api', () => ({ apiPost: (...args: unknown[]) => apiPost(...args), apiPut: vi.fn() }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

const inList = [{ id: 'L', name: 'L' }]
// State order A, B, C (oldest first); the list draws C, B, A (newest first).
const tasks = [
  { id: 'A', title: 'A', createdAt: '2026-01-01T00:00:01Z', lists: inList },
  { id: 'B', title: 'B', createdAt: '2026-01-01T00:00:02Z', lists: inList },
  { id: 'C', title: 'C', createdAt: '2026-01-01T00:00:03Z', lists: inList },
] as unknown as Task[]
const list = { id: 'L', name: 'L', isVirtual: false, manualSortOrder: null } as unknown as TaskList

describe('ADEV-322: manual reorder commits from the displayed order', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiPost.mockResolvedValue({ ok: true, json: async () => ({ id: 'L' }) })
  })

  it('drops the bottom row above the top row where it was dropped', async () => {
    const { result } = renderHook(() =>
      useTaskDragDrop({
        tasks,
        lists: [list],
        selectedListId: 'L',
        currentUserId: 'u1',
        manualSortActive: true,
        myTasksManualSortOrder: undefined,
        setMyTasksManualSortOrder: vi.fn(),
        setTasks: vi.fn(),
        setLists: vi.fn(),
        setSelectedTaskId: vi.fn(),
        newTaskOperations: { current: null } as never,
      }),
    )

    // Drawn: C, B, A. Pick up A (last) and drop it above C (first).
    act(() => result.current.handleTaskDragStart('A'))
    act(() => result.current.handleTaskDragHover('C', 'above'))
    act(() => result.current.handleTaskDragEnd())

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1))
    expect(apiPost).toHaveBeenCalledWith('/api/lists/L/manual-order', { order: ['A', 'C', 'B'] })
  })
})
