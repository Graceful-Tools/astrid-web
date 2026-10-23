import { describe, it, expect } from 'vitest'
import { shouldOpenCreatedTask } from '@/hooks/task-manager/create-task-options'

/**
 * AWTD-1351: creating a task used to select it on every multi-column layout,
 * whatever the caller asked for. The row's click handler toggles, so the
 * first click on a task quick add had just made took the "close" branch and
 * looked swallowed. Only a caller that asks to open the task — quick add's
 * button, not Enter — opens it.
 */
describe('shouldOpenCreatedTask (AWTD-1351)', () => {
  it('does not open a task created with Enter (no navigateToDetail)', () => {
    expect(shouldOpenCreatedTask({ navigateToDetail: false }, 3)).toBe(false)
    expect(shouldOpenCreatedTask({ priority: 1 }, 2)).toBe(false)
    expect(shouldOpenCreatedTask(undefined, 3)).toBe(false)
  })

  it('does not open a subtask or a board-column task, which never ask', () => {
    expect(shouldOpenCreatedTask({ parentTaskId: 'parent' }, 3)).toBe(false)
    expect(shouldOpenCreatedTask({ statusRole: 'ready', listIds: ['l'] }, 3)).toBe(false)
  })

  it('opens a task when asked, where a detail pane can show beside the list', () => {
    expect(shouldOpenCreatedTask({ navigateToDetail: true }, 2)).toBe(true)
    expect(shouldOpenCreatedTask({ navigateToDetail: true }, 3)).toBe(true)
  })

  it('keeps one column on the list, as before', () => {
    expect(shouldOpenCreatedTask({ navigateToDetail: true }, 1)).toBe(false)
  })
})
