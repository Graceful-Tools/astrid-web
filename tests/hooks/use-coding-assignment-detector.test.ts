import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { buildTask, buildUser } from '../fixtures/domain'
import { renderHook, waitFor } from '@testing-library/react'
import { useCodingAssignmentDetector } from '@/hooks/use-coding-assignment-detector'
import type { Task, User } from '@/types/task'
import { BRAND } from '@/lib/brand/config'

// Mock toast - create inside the mock factory to avoid hoisting issues
vi.mock('@/hooks/use-toast', () => {
  const mockToast = vi.fn()
  return {
    toast: mockToast,
    useToast: () => ({
      toast: mockToast,
      dismiss: vi.fn(),
      toasts: []
    })
  }
})

// Get the mocked toast for assertions. `vi.mocked` is what carries the mock
// type across the dynamic import — the bare binding is typed as the real
// function, so `.mockClear()` did not exist on it. (AWTD-916)
const mockToast = vi.mocked((await import('@/hooks/use-toast')).toast)

// Mock isCodingAgent
vi.mock('@/lib/ai-agent-utils', () => ({
  isCodingAgent: (user: any) => user?.isAIAgent === true && user?.aiAgentType === 'coding_agent'
}))

describe('useCodingAssignmentDetector', () => {
  // `repeating: 'none'` was not a value of the union at all — it is 'never'
  // (AWTD-916). `description` was null where the type says string, and
  // `aiAgentId` is not a field of Task.
  const mockTask: Task = buildTask({
    id: 'test-task-id',
    title: 'Test Task',
    priority: 1,
    creatorId: 'user-1',
    assigneeId: null,
    assignee: null,
    creator: buildUser({ id: 'user-1', name: 'User', email: 'user@test.com' }),
    dueDateTime: null,
  })

  const mockCodingAgent: User = buildUser({
    id: 'agent-1',
    name: 'Claude Agent',
    email: `claude@${BRAND.agentEmailDomain}`,
    isAIAgent: true,
    aiAgentType: 'coding_agent',
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockToast.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should show success toast when coding agent is assigned', async () => {
    const taskWithAgent = { ...mockTask, assignee: mockCodingAgent, assigneeId: mockCodingAgent.id }
    const { rerender } = renderHook(
      ({ task }) => useCodingAssignmentDetector(task),
      { initialProps: { task: mockTask } }
    )

    // Trigger assignment by updating to task with agent
    rerender({ task: taskWithAgent })

    // Wait for toast to be called
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '🤖 AI Agent Assigned',
          description: 'Claude Agent will start working on this task shortly.',
          variant: 'default',
          duration: 5000
        })
      )
    })
  })

  it('should call onWorkflowCreated callback when provided', async () => {
    const mockCallback = vi.fn()
    const taskWithAgent = { ...mockTask, assignee: mockCodingAgent, assigneeId: mockCodingAgent.id }
    const { rerender } = renderHook(
      ({ task, callback }) => useCodingAssignmentDetector(task, callback),
      { initialProps: { task: mockTask, callback: mockCallback } }
    )

    // Trigger assignment
    rerender({ task: taskWithAgent, callback: mockCallback })

    // Wait for callback to be called with task id
    await waitFor(() => {
      expect(mockCallback).toHaveBeenCalledWith('test-task-id')
    })
  })

  it('should not trigger on non-coding agent assignment', async () => {
    const normalUser: User = {
      id: 'user-2',
      name: 'Normal User',
      email: 'user@test.com',
      isAIAgent: false,
      aiAgentType: null
    } as User

    const taskWithUser = { ...mockTask, assignee: normalUser, assigneeId: normalUser.id }
    const { rerender } = renderHook(
      ({ task }) => useCodingAssignmentDetector(task),
      { initialProps: { task: mockTask } }
    )

    rerender({ task: taskWithUser })

    // Should not show toast for non-coding agent
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('should not trigger for new tasks (id starts with "new-")', async () => {
    const newTask = { ...mockTask, id: 'new-temp-id' }
    const taskWithAgent = { ...newTask, assignee: mockCodingAgent, assigneeId: mockCodingAgent.id }
    const { rerender } = renderHook(
      ({ task }) => useCodingAssignmentDetector(task),
      { initialProps: { task: newTask } }
    )

    rerender({ task: taskWithAgent })

    // Should not show toast for new tasks
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('should not trigger when reassigning between coding agents', async () => {
    const anotherCodingAgent: User = {
      id: 'agent-2',
      name: 'OpenAI Agent',
      email: `openai@${BRAND.agentEmailDomain}`,
      isAIAgent: true,
      aiAgentType: 'coding_agent'
    } as User

    const taskWithAgent1 = { ...mockTask, assignee: mockCodingAgent, assigneeId: mockCodingAgent.id }
    const taskWithAgent2 = { ...mockTask, assignee: anotherCodingAgent, assigneeId: anotherCodingAgent.id }

    const { rerender } = renderHook(
      ({ task }) => useCodingAssignmentDetector(task),
      { initialProps: { task: taskWithAgent1 } }
    )

    // Clear any initial calls
    mockToast.mockClear()

    // Reassign to another coding agent
    rerender({ task: taskWithAgent2 })

    // Should not trigger toast since previous was already a coding agent
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(mockToast).not.toHaveBeenCalled()
  })
})
