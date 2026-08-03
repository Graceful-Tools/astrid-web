import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskDetail } from '@/components/task-detail'
import type { Task, User, TaskList } from '@/types/task'
import { ThemeProvider } from '@/contexts/theme-context'
import { SettingsProvider } from '@/contexts/settings-context'

// Mock the SSE subscription hook
vi.mock('@/hooks/use-sse-subscription', () => ({
  useSSESubscription: vi.fn()
}))

// Mock the coding assignment detector hook
vi.mock('@/hooks/use-coding-assignment-detector', () => ({
  useCodingAssignmentDetector: vi.fn()
}))

// Mock the reminder manager
vi.mock('@/lib/reminder-manager', () => ({
  useReminders: vi.fn(() => ({
    triggerManualReminder: vi.fn()
  }))
}))

describe('TaskDetail Optimistic Checkbox Update', () => {
  const mockUser: User = {
    id: 'user-1',
    name: 'Test User',
    email: 'test@example.com',
    avatarUrl: null
  }

  const mockList: TaskList = {
    id: 'list-1',
    name: 'Test List',
    color: '#3b82f6',
    privacy: 'PRIVATE',
    ownerId: 'user-1'
  }

  const mockTask: Task = {
    id: 'task-1',
    title: 'Test Task',
    description: '',
    completed: false,
    priority: 0,
    repeating: 'never',
    dueDateTime: null,
    isAllDay: false,
    lists: [mockList],
    comments: [],
    createdAt: new Date().toISOString(),
    userId: 'user-1',
    // Assigned to the viewer so the leading control is the checkbox these
    // tests are about. Leaving it unassigned renders the "U" mark instead
    // (task 2bb1b196) — a different control, exercised in its own test.
    assigneeId: 'user-1'
  }

  let onUpdateMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onUpdateMock = vi.fn()
  })

  const renderTaskDetail = (task: Task, onUpdate = onUpdateMock) => {
    return render(
      <ThemeProvider>
        <SettingsProvider>
          <TaskDetail
            task={task}
            currentUser={mockUser}
            availableLists={[mockList]}
            onUpdate={onUpdate}
            onDelete={vi.fn()}
          />
        </SettingsProvider>
      </ThemeProvider>
    )
  }

  it('updates checkbox immediately when clicked (before API response)', async () => {
    const user = userEvent.setup()

    // Create a delayed promise to simulate API call
    let resolveUpdate: (value: void) => void
    const delayedPromise = new Promise<void>((resolve) => {
      resolveUpdate = resolve
    })

    const delayedOnUpdate = vi.fn(() => delayedPromise)

    renderTaskDetail(mockTask, delayedOnUpdate)

    // Find the checkbox image (it has an alt text)
    const checkbox = screen.getByAltText(/unchecked.*checkbox/i)

    // Verify initial state (unchecked)
    expect(checkbox).toHaveAttribute('alt', expect.stringContaining('Unchecked'))

    // Click the checkbox (click on its parent container)
    const checkboxContainer = checkbox.parentElement!
    await user.click(checkboxContainer)

    // Verify checkbox updates immediately (optimistically) before API call completes
    // After click, the alt text should change to "Checked"
    await waitFor(() => {
      const updatedCheckbox = screen.getByAltText(/checked.*checkbox/i)
      expect(updatedCheckbox).toBeInTheDocument()
    })

    expect(delayedOnUpdate).toHaveBeenCalledTimes(1)
    expect(delayedOnUpdate).toHaveBeenCalledWith({
      ...mockTask,
      completed: true
    })

    // Resolve the API call
    resolveUpdate!()
    await delayedPromise
  })

  it('keeps checkbox checked if API call succeeds', async () => {
    const user = userEvent.setup()

    // Mock successful API call
    const successfulUpdate = vi.fn().mockResolvedValue(undefined)

    renderTaskDetail(mockTask, successfulUpdate)

    // Find the checkbox
    const checkbox = screen.getByAltText(/unchecked.*checkbox/i)
    const checkboxContainer = checkbox.parentElement!

    // Click the checkbox
    await user.click(checkboxContainer)

    // Verify checkbox updates immediately
    await waitFor(() => {
      const updatedCheckbox = screen.getByAltText(/checked.*checkbox/i)
      expect(updatedCheckbox).toBeInTheDocument()
    })

    // Wait for API call to complete
    await waitFor(() => {
      expect(successfulUpdate).toHaveBeenCalledTimes(1)
    })

    // Verify checkbox remains checked after API call succeeds
    const finalCheckbox = screen.getByAltText(/checked.*checkbox/i)
    expect(finalCheckbox).toBeInTheDocument()
  })

  it('reverts checkbox to unchecked if API call fails', async () => {
    const user = userEvent.setup()

    // Mock failed API call
    const failedUpdate = vi.fn().mockRejectedValue(new Error('API Error'))

    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderTaskDetail(mockTask, failedUpdate)

    // Find the checkbox
    const checkbox = screen.getByAltText(/unchecked.*checkbox/i)
    const checkboxContainer = checkbox.parentElement!

    // Verify initial state (unchecked)
    expect(checkbox).toHaveAttribute('alt', expect.stringContaining('Unchecked'))

    // Click the checkbox
    await user.click(checkboxContainer)

    // Verify checkbox updates immediately (optimistically)
    await waitFor(() => {
      const checkedBox = screen.getByAltText(/checked.*checkbox/i)
      expect(checkedBox).toBeInTheDocument()
    })

    // Wait for API call to fail
    await waitFor(() => {
      expect(failedUpdate).toHaveBeenCalledTimes(1)
    })

    // Wait a bit for the rollback to occur
    await waitFor(() => {
      // Verify checkbox reverts to unchecked after API call fails
      const uncheckedBox = screen.getByAltText(/unchecked.*checkbox/i)
      expect(uncheckedBox).toBeInTheDocument()
    })

    consoleSpy.mockRestore()
  })

  it('handles multiple rapid clicks correctly', async () => {
    const user = userEvent.setup()

    // Mock API call with small delay
    const onUpdate = vi.fn().mockImplementation(() =>
      new Promise((resolve) => setTimeout(resolve, 50))
    )

    renderTaskDetail(mockTask, onUpdate)

    // Find the checkbox
    const checkbox = screen.getByAltText(/unchecked.*checkbox/i)
    const checkboxContainer = checkbox.parentElement!

    // Click multiple times rapidly
    await user.click(checkboxContainer)
    await user.click(checkboxContainer)
    await user.click(checkboxContainer)

    // Wait for all API calls to complete
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledTimes(3)
    })

    // Final state should reflect the last click (checked -> unchecked -> checked)
    await waitFor(() => {
      const finalCheckbox = screen.getByAltText(/checked.*checkbox/i)
      expect(finalCheckbox).toBeInTheDocument()
    })
  })

  it('syncs tempCompleted when task.completed changes externally', async () => {
    const { rerender } = renderTaskDetail(mockTask)

    // Find the checkbox
    const checkbox = screen.getByAltText(/unchecked.*checkbox/i)

    // Verify initial state (unchecked)
    expect(checkbox).toHaveAttribute('alt', expect.stringContaining('Unchecked'))

    // Simulate external update (e.g., from SSE)
    const updatedTask = { ...mockTask, completed: true }
    rerender(
      <ThemeProvider>
        <SettingsProvider>
          <TaskDetail
            task={updatedTask}
            currentUser={mockUser}
            availableLists={[mockList]}
            onUpdate={onUpdateMock}
            onDelete={vi.fn()}
          />
        </SettingsProvider>
      </ThemeProvider>
    )

    // Verify checkbox updates to reflect external change
    await waitFor(() => {
      const checkedBox = screen.getByAltText(/checked.*checkbox/i)
      expect(checkedBox).toBeInTheDocument()
    })
  })
})
