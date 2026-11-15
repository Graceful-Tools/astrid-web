import { describe, it, expect, beforeEach, vi } from 'vitest'

const createAIAgentComment = vi.fn(async (..._args: unknown[]) => ({ success: true }))
const completeTask = vi.fn(async (..._args: unknown[]) => ({ ok: true }))
const workflowUpdate = vi.fn(async (..._args: unknown[]) => ({}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    codingTaskWorkflow: {
      findUnique: vi.fn(async () => ({
        id: 'wf-1',
        status: 'TESTING',
        repositoryId: 'Graceful-Tools/example',
        pullRequestNumber: 42,
        task: { creatorId: 'human-1', creator: { id: 'human-1' } },
      })),
      update: (...args: unknown[]) => workflowUpdate(...args),
    },
    task: {
      findUnique: vi.fn(async () => ({ id: 't-1', assignee: { isAIAgent: true } })),
    },
  },
}))
vi.mock('@/lib/ai-agent-comment-service', () => ({
  createAIAgentComment: (...args: unknown[]) => createAIAgentComment(...args),
}))
vi.mock('@/services/complete-task', () => ({
  completeTask: (...args: unknown[]) => completeTask(...args),
}))
vi.mock('@/lib/ai/agent-execution-mode', () => ({
  getAgentExecutionMode: vi.fn(),
  resolveAgentRunOwnerId: vi.fn(),
  shouldPostServerWorkflowComments: vi.fn(),
}))
vi.mock('@/lib/runtime-binding/task-runtime', () => ({ boundDispatchHold: vi.fn() }))

import { processCommentForMergeRequest } from '@/lib/comment-approval-detector'

describe('AWTD-1690: a "merge" reply must not claim a merge that did not happen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not complete the task or workflow, and does not say it is shipping', async () => {
    await processCommentForMergeRequest('t-1', 'c-1', 'merge it', 'human-1')

    expect(completeTask).not.toHaveBeenCalled()
    expect(workflowUpdate).not.toHaveBeenCalled()
    const bodies = createAIAgentComment.mock.calls.map(c => String(c[1]))
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).not.toMatch(/Shipping to Production|Deploying your approved/i)
    expect(bodies[0]).toMatch(/cannot merge/i)
    expect(bodies[0]).toContain('https://github.com/Graceful-Tools/example/pull/42')
  })
})
