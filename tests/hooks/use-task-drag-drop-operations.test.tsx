/**
 * @vitest-environment jsdom
 */

/**
 * Dropping a task on a list actually writes it (task ce2553e8).
 *
 * `useTaskManagerController` builds this hook BEFORE `useTaskOperations` exists,
 * so it passed `newTaskOperations: null as any` with a comment promising to
 * reconnect it. The reconnection never happened — the hook captured `null` at
 * construction and kept it.
 *
 * The failure is quiet, which is why it survived: the call is inside
 * `handleTaskDropOnList`'s own try/catch, so the optimistic update moves the
 * task, the write throws `Cannot read properties of null`, the catch reverts it,
 * and the user gets "Unable to update task". It reads like a server fault.
 *
 * The fix is to hand the hook a REF and read through it at call time, which is
 * what "we can't reassign" actually needed.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTaskDragDrop } from '@/hooks/task-manager/useTaskDragDrop'
import type { Task, TaskList } from '@/types/task'

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

const list = { id: 'l2', name: 'Other', isVirtual: false } as TaskList
const task = { id: 't1', title: 'Card', lists: [{ id: 'l1', name: 'Work' }] } as Task

function setup(operationsRef: React.MutableRefObject<any>) {
  return renderHook(() =>
    useTaskDragDrop({
      tasks: [task],
      lists: [{ id: 'l1', name: 'Work', isVirtual: false } as TaskList, list],
      selectedListId: 'l1',
      currentUserId: 'u1',
      manualSortActive: false,
      myTasksManualSortOrder: undefined,
      setMyTasksManualSortOrder: vi.fn(),
      setTasks: vi.fn(),
      setLists: vi.fn(),
      setSelectedTaskId: vi.fn(),
      newTaskOperations: operationsRef,
    }),
  )
}

describe('useTaskDragDrop operations wiring (task ce2553e8)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes through operations that were attached AFTER the hook was built', async () => {
    // The exact shape of the bug: the controller cannot pass real operations at
    // construction, so it fills them in afterwards. Reading through the ref at
    // call time is what makes that work.
    const updateTaskLists = vi.fn().mockResolvedValue({ ...task, title: 'Card' })
    const ref: React.MutableRefObject<any> = { current: null }

    const { result } = setup(ref)
    ref.current = { updateTaskLists }

    act(() => result.current.handleTaskDragStart('t1'))
    await act(async () => {
      await result.current.handleTaskDropOnList('l2', { shiftKey: false })
    })

    await waitFor(() => expect(updateTaskLists).toHaveBeenCalledTimes(1))
    expect(updateTaskLists).toHaveBeenCalledWith('t1', ['l2'], task)
  })

  it('does not throw when the drop happens before operations are attached', async () => {
    // Defensive: a drop during the first render pass must be a no-op, not a
    // TypeError swallowed by the catch and shown as a server error.
    const ref: React.MutableRefObject<any> = { current: null }
    const { result } = setup(ref)

    act(() => result.current.handleTaskDragStart('t1'))
    await act(async () => {
      await result.current.handleTaskDropOnList('l2', { shiftKey: false })
    })

    expect(result.current.activeDragTaskId).toBeNull()
  })
})
