import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { buildTask } from '../fixtures/domain'
import { useOpenTaskFromUrl, type UseOpenTaskFromUrlProps } from '@/hooks/task-manager/useOpenTaskFromUrl'

const tasks = [buildTask({ id: 'task-x' }), buildTask({ id: 'task-y' })]

function setup(initial: Partial<UseOpenTaskFromUrlProps>) {
  const setSelectedTaskId = vi.fn()
  const setMobileView = vi.fn()
  const base: UseOpenTaskFromUrlProps = {
    urlTaskId: undefined,
    loading: false,
    tasks,
    selectedTaskId: '',
    setSelectedTaskId,
    isMobile: true,
    setMobileView,
  }
  const hook = renderHook((props: UseOpenTaskFromUrlProps) => useOpenTaskFromUrl(props), {
    initialProps: { ...base, ...initial },
  })
  return {
    setSelectedTaskId,
    rerender: (next: Partial<UseOpenTaskFromUrlProps>) => hook.rerender({ ...base, ...next }),
  }
}

describe('useOpenTaskFromUrl', () => {
  it('opens the task a link names once the tasks have loaded', () => {
    const { setSelectedTaskId, rerender } = setup({ urlTaskId: 'task-x', loading: true, tasks: [] })
    expect(setSelectedTaskId).not.toHaveBeenCalled()

    rerender({ urlTaskId: 'task-x' })
    expect(setSelectedTaskId).toHaveBeenCalledWith('task-x')
  })

  it('AWTD-1076: switching lists does not reopen the task the stale ?task= still names', () => {
    // Task X is open, so the URL says ?task=task-x.
    const { setSelectedTaskId, rerender } = setup({ urlTaskId: 'task-x', selectedTaskId: 'task-x' })

    // Switching lists clears the selection in the same render, but the URL
    // change reaches the search params one render later, so ?task= is still X.
    rerender({ urlTaskId: 'task-x', selectedTaskId: '' })
    expect(setSelectedTaskId).not.toHaveBeenCalledWith('task-x')

    // Then the new URL arrives, without a task.
    rerender({ urlTaskId: undefined, selectedTaskId: '' })
    expect(setSelectedTaskId).not.toHaveBeenCalled()
  })

  it('AWTD-1076: tapping another task does not flip back to the one the URL named before', () => {
    const { setSelectedTaskId, rerender } = setup({ urlTaskId: 'task-x', selectedTaskId: 'task-x' })

    // The tap selects Y; ?task= still says X until the router catches up.
    rerender({ urlTaskId: 'task-x', selectedTaskId: 'task-y' })
    rerender({ urlTaskId: 'task-y', selectedTaskId: 'task-y' })

    expect(setSelectedTaskId).not.toHaveBeenCalled()
  })

  it('opens a task from a NEW link after the URL had dropped its task', () => {
    const { setSelectedTaskId, rerender } = setup({ urlTaskId: 'task-x', selectedTaskId: 'task-x' })
    rerender({ urlTaskId: undefined, selectedTaskId: '' })

    rerender({ urlTaskId: 'task-x', selectedTaskId: '' })
    expect(setSelectedTaskId).toHaveBeenCalledWith('task-x')
  })
})
