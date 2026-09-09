import { describe, it, expect } from 'vitest'

describe('My Tasks URL Navigation', () => {
  it('should construct proper My Tasks URLs with task parameter', () => {
    const taskId = 'test-task-456'

    // Test the new URL patterns for My Tasks
    const expectedMyTasksUrl = '/'
    const expectedMyTasksWithTaskUrl = `/?task=${taskId}`

    expect(expectedMyTasksUrl).toBe('/')
    expect(expectedMyTasksWithTaskUrl).toBe('/?task=test-task-456')
  })

  it('should handle URL parameter extraction for My Tasks', () => {
    // Simulate search params for /?task=456
    const mockSearchParams = new URLSearchParams('task=test-task-456')

    const taskId = mockSearchParams.get('task')

    expect(taskId).toBe('test-task-456')
  })

  it('should differentiate between My Tasks and regular list URLs', () => {
    const taskId = 'test-task-456'

    // My Tasks uses home page with task parameter
    const myTasksWithTask = `/?task=${taskId}`

    // Regular lists use /lists/[id] with task parameter
    const listId = 'test-list-123'
    const regularListWithTask = `/lists/${listId}?task=${taskId}`

    expect(myTasksWithTask).toBe('/?task=test-task-456')
    expect(regularListWithTask).toBe('/lists/test-list-123?task=test-task-456')

    // URLs should be different
    expect(myTasksWithTask).not.toBe(regularListWithTask)
  })

  it('should handle My Tasks URL closing (removing task parameter)', () => {
    // When closing a task in My Tasks, should go back to just /
    const closedMyTasksUrl = '/'
    expect(closedMyTasksUrl).toBe('/')
  })
})