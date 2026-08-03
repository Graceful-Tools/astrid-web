import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTaskDetailState } from '@/hooks/task-detail/useTaskDetailState'
import type { Task } from '@/types/task'

const mockTask: Task = {
  id: '1',
  title: 'Test Task',
  description: 'Test Description',
  when: new Date('2025-01-15'),
  priority: 2,
  repeating: 'DAILY',
  repeatingData: { interval: 1 },
  completed: false,
  listId: 'list-1',
  createdAt: new Date(),
  updatedAt: new Date()
} as Task

describe('useTaskDetailState', () => {
  it('should initialize with task values', () => {
    const { result } = renderHook(() => useTaskDetailState(mockTask))

    expect(result.current.tempValues.title).toBe('Test Task')
    expect(result.current.tempValues.description).toBe('Test Description')
    expect(result.current.tempValues.priority).toBe(2)
    expect(result.current.tempValues.repeating).toBe('DAILY')
  })

  it('should expose all comment state', () => {
    const { result } = renderHook(() => useTaskDetailState(mockTask))

    expect(result.current.comments).toHaveProperty('newComment')
    expect(result.current.comments).toHaveProperty('setNewComment')
    expect(result.current.comments).toHaveProperty('uploadingFile')
    expect(result.current.comments).toHaveProperty('attachedFiles')
    expect(result.current.comments).toHaveProperty('replyingTo')
  })

  it('should expose all modal state', () => {
    const { result } = renderHook(() => useTaskDetailState(mockTask))

    expect(result.current.modals).toHaveProperty('showDeleteConfirmation')
    expect(result.current.modals).toHaveProperty('showCopyConfirmation')
    expect(result.current.modals).toHaveProperty('showShareModal')
    expect(result.current.modals).toHaveProperty('shareUrl')
  })

  it('should expose all editing state', () => {
    const { result } = renderHook(() => useTaskDetailState(mockTask))

    expect(result.current.editing).toHaveProperty('title')
    expect(result.current.editing).toHaveProperty('description')
    expect(result.current.editing).toHaveProperty('when')
    expect(result.current.editing).toHaveProperty('priority')
    expect(result.current.editing).toHaveProperty('assignee')
  })

  it('should expose list selection state', () => {
    const { result } = renderHook(() => useTaskDetailState(mockTask))

    expect(result.current.listSelection).toHaveProperty('searchTerm')
    expect(result.current.listSelection).toHaveProperty('showSuggestions')
    expect(result.current.listSelection).toHaveProperty('searchRef')
    expect(result.current.listSelection).toHaveProperty('inputRef')
  })

  it('should allow updating comment state', () => {
    const { result } = renderHook(() => useTaskDetailState(mockTask))

    act(() => {
      result.current.comments.setNewComment('New comment text')
    })

    expect(result.current.comments.newComment).toBe('New comment text')
  })

  it('should allow toggling modal state', () => {
    const { result } = renderHook(() => useTaskDetailState(mockTask))

    expect(result.current.modals.showDeleteConfirmation).toBe(false)

    act(() => {
      result.current.modals.setShowDeleteConfirmation(true)
    })

    expect(result.current.modals.showDeleteConfirmation).toBe(true)
  })

  it('should allow toggling editing state', () => {
    const { result } = renderHook(() => useTaskDetailState(mockTask))

    expect(result.current.editing.title).toBe(false)

    act(() => {
      result.current.editing.setEditingTitle(true)
    })

    expect(result.current.editing.title).toBe(true)
  })

  it('should allow updating temp values', () => {
    const { result } = renderHook(() => useTaskDetailState(mockTask))

    act(() => {
      result.current.tempValues.setTempTitle('Updated Title')
    })

    expect(result.current.tempValues.title).toBe('Updated Title')
  })

  it('should sync temp title when task title changes and not editing', () => {
    const { result, rerender } = renderHook(
      ({ task }) => useTaskDetailState(task),
      { initialProps: { task: mockTask } }
    )

    const updatedTask = { ...mockTask, title: 'Updated Task' }

    rerender({ task: updatedTask })

    expect(result.current.tempValues.title).toBe('Updated Task')
  })

  it('should NOT sync temp title when editing', () => {
    const { result, rerender } = renderHook(
      ({ task }) => useTaskDetailState(task),
      { initialProps: { task: mockTask } }
    )

    // Start editing
    act(() => {
      result.current.editing.setEditingTitle(true)
      result.current.tempValues.setTempTitle('User typing...')
    })

    // Task updates externally
    const updatedTask = { ...mockTask, title: 'External Update' }
    rerender({ task: updatedTask })

    // Should keep user's typing, not overwrite
    expect(result.current.tempValues.title).toBe('User typing...')
  })

  it('should provide refs for list selection', () => {
    const { result } = renderHook(() => useTaskDetailState(mockTask))

    expect(result.current.listSelection.searchRef.current).toBe(null)
    expect(result.current.listSelection.inputRef.current).toBe(null)
  })

  it('should provide refs for editing elements', () => {
    const { result } = renderHook(() => useTaskDetailState(mockTask))

    expect(result.current.editing.assigneeRef.current).toBe(null)
    expect(result.current.editing.descriptionRef.current).toBe(null)
    expect(result.current.editing.descriptionTextareaRef.current).toBe(null)
  })

  it('should handle task with no description', () => {
    const taskNoDesc = { ...mockTask, description: null }
    const { result } = renderHook(() => useTaskDetailState(taskNoDesc))

    expect(result.current.tempValues.description).toBe('')
  })

  it('should handle task with undefined when date', () => {
    const taskNoWhen = { ...mockTask, when: undefined }
    const { result } = renderHook(() => useTaskDetailState(taskNoWhen))

    expect(result.current.tempValues.when).toBeUndefined()
  })

  describe('tempWhen resync (regression)', () => {
    const baseTime = new Date('2025-06-15T21:00:00Z') // 9pm UTC
    const taskWithTime: Task = { ...mockTask, dueDateTime: baseTime } as Task

    it('syncs tempWhen when neither date nor time is being edited', () => {
      const { result, rerender } = renderHook(
        ({ task }) => useTaskDetailState(task),
        { initialProps: { task: taskWithTime } }
      )

      const newTime = new Date('2025-06-15T15:00:00Z')
      rerender({ task: { ...taskWithTime, dueDateTime: newTime } as Task })

      expect(result.current.tempValues.when?.toISOString()).toBe(newTime.toISOString())
    })

    it('does NOT overwrite tempWhen while the time picker is open', () => {
      // Regression: parent re-renders (SSE typing indicator, focus events on
      // mobile, etc.) used to stomp the in-flight time-picker selection
      // because the resync useEffect only gated on editingWhen.
      const { result, rerender } = renderHook(
        ({ task }) => useTaskDetailState(task),
        { initialProps: { task: taskWithTime } }
      )

      act(() => {
        result.current.editing.setEditingTime(true)
        // User has tapped a new value in the picker but not yet committed
        result.current.tempValues.setTempWhen(new Date('2025-06-15T19:00:00Z'))
      })

      // Parent re-renders with a fresh task reference (same data, new instance)
      rerender({ task: { ...taskWithTime, dueDateTime: new Date(baseTime) } as Task })

      expect(result.current.tempValues.when?.toISOString()).toBe(
        new Date('2025-06-15T19:00:00Z').toISOString()
      )
    })

    it('does NOT overwrite tempWhen while the date picker is open', () => {
      const { result, rerender } = renderHook(
        ({ task }) => useTaskDetailState(task),
        { initialProps: { task: taskWithTime } }
      )

      act(() => {
        result.current.editing.setEditingWhen(true)
        result.current.tempValues.setTempWhen(new Date('2025-07-01T21:00:00Z'))
      })

      rerender({ task: { ...taskWithTime, dueDateTime: new Date(baseTime) } as Task })

      expect(result.current.tempValues.when?.toISOString()).toBe(
        new Date('2025-07-01T21:00:00Z').toISOString()
      )
    })

    it('resumes syncing tempWhen after the time picker closes', () => {
      const { result, rerender } = renderHook(
        ({ task }) => useTaskDetailState(task),
        { initialProps: { task: taskWithTime } }
      )

      act(() => {
        result.current.editing.setEditingTime(true)
        result.current.tempValues.setTempWhen(new Date('2025-06-15T19:00:00Z'))
      })

      // Close the picker
      act(() => {
        result.current.editing.setEditingTime(false)
      })

      // Parent now updates the canonical task
      const committed = new Date('2025-06-15T19:30:00Z')
      rerender({ task: { ...taskWithTime, dueDateTime: committed } as Task })

      expect(result.current.tempValues.when?.toISOString()).toBe(committed.toISOString())
    })
  })
})
