import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock all the dynamically-imported and prisma-touching modules so the helper
// can run without a real database. These mocks let us assert *which* side
// effects were dispatched for a given input.

const invalidateUserStats = vi.fn()
const sendCommentNotification = vi.fn()
const processAstridComment = vi.fn(() => Promise.resolve())
const processCommentForWorkflowAction = vi.fn(() => Promise.resolve())
const notifyCommentOnAssignedTask = vi.fn(() => Promise.resolve())

let astridUserId: string | null = null
let assigneeUserIsAgent = false

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findMany: vi.fn(async ({ where }: any) => {
        const ids = where.id.in as string[]
        return ids.flatMap(id => {
          if (id === astridUserId) {
            return [{ id, isAIAgent: true, email: 'astrid@astrid.cc' }]
          }
          if (id === 'human-1') return [{ id, isAIAgent: false, email: 'h1@example.com' }]
          if (id === 'human-2') return [{ id, isAIAgent: false, email: 'h2@example.com' }]
          if (id === 'agent-claude' && assigneeUserIsAgent) {
            return [{ id, isAIAgent: true, email: 'claude@astrid.cc' }]
          }
          return []
        })
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id === astridUserId) {
          return { id: astridUserId, isAIAgent: true, email: 'astrid@astrid.cc' }
        }
        if (where.id === 'human-1') return { id: 'human-1', isAIAgent: false, email: 'h1@example.com' }
        if (where.id === 'human-2') return { id: 'human-2', isAIAgent: false, email: 'h2@example.com' }
        if (where.id === 'agent-claude' && assigneeUserIsAgent) {
          return { id: 'agent-claude', isAIAgent: true, email: 'claude@astrid.cc' }
        }
        return null
      }),
    },
    codingTaskWorkflow: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'wf-1' })) },
  },
}))

vi.mock('@/lib/user-stats', () => ({
  invalidateUserStats: (...args: any[]) => invalidateUserStats(...args),
}))

vi.mock('@/lib/push-notification-service', () => ({
  PushNotificationService: class {
    sendCommentNotification(...args: any[]) {
      return sendCommentNotification(...args)
    }
  },
}))

vi.mock('@/lib/astrid-agent', () => ({ ASTRID_EMAIL: 'astrid@astrid.cc' }))
vi.mock('@/lib/astrid-agent-runtime', () => ({ processAstridComment }))
vi.mock('@/lib/comment-approval-detector', () => ({ processCommentForWorkflowAction }))
vi.mock('@/lib/ai-agent-webhook-service', () => ({
  aiAgentWebhookService: { notifyCommentOnAssignedTask },
}))
vi.mock('@/lib/ai/agent-config', () => ({ getAgentService: () => 'claude' }))
vi.mock('@/lib/ai-orchestrator', () => ({
  AIOrchestrator: {
    createForTask: vi.fn(async () => ({
      executeCompleteWorkflow: vi.fn(() => Promise.resolve()),
    })),
  },
}))

import { dispatchPostCommentSideEffects } from '@/lib/comments/post-comment-side-effects'
import { prisma } from '@/lib/prisma'

const baseTask = {
  id: 'task-1',
  title: 'Do the thing',
  creatorId: 'human-2',
  assigneeId: null,
  assignee: null,
  lists: [{ id: 'list-1' }],
}

const humanCommenter = {
  id: 'human-1',
  name: 'Alice',
  email: 'alice@example.com',
  isAIAgent: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  astridUserId = 'astrid-uid'
  assigneeUserIsAgent = false
})

describe('dispatchPostCommentSideEffects', () => {
  it('invalidates stats when commenting on someone else’s task', async () => {
    await dispatchPostCommentSideEffects({
      comment: { id: 'c-1', content: 'hi' },
      task: baseTask,
      commenter: humanCommenter,
    })
    expect(invalidateUserStats).toHaveBeenCalledWith('human-1')
  })

  it('does not invalidate stats when commenter is the task creator', async () => {
    await dispatchPostCommentSideEffects({
      comment: { id: 'c-1', content: 'hi' },
      task: { ...baseTask, creatorId: 'human-1' },
      commenter: humanCommenter,
    })
    expect(invalidateUserStats).not.toHaveBeenCalled()
  })

  it('triggers Astrid when @-mentioned', async () => {
    await dispatchPostCommentSideEffects({
      comment: { id: 'c-1', content: 'hey @[Astrid](astrid-uid) help' },
      task: baseTask,
      commenter: humanCommenter,
    })
    expect(processAstridComment).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        userId: 'human-1',
        commentContent: 'hey @[Astrid](astrid-uid) help',
      })
    )
  })

  it('sends a push notification when a human user is @-mentioned', async () => {
    await dispatchPostCommentSideEffects({
      comment: { id: 'c-1', content: 'fyi @[Bob](human-2)' },
      task: baseTask,
      commenter: humanCommenter,
    })
    expect(sendCommentNotification).toHaveBeenCalledWith(
      'human-2',
      expect.objectContaining({ type: 'mention', taskId: 'task-1' })
    )
  })

  it('AWTD-performance batches mentioned-user lookups', async () => {
    await dispatchPostCommentSideEffects({
      comment: {
        id: 'c-1',
        content: 'fyi @[Bob](human-2) and @[Astrid](astrid-uid)',
      },
      task: baseTask,
      commenter: humanCommenter,
    })

    expect(prisma.user.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['human-2', 'astrid-uid'] } },
      select: { id: true, isAIAgent: true, email: true },
    })
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('falls back to isolated lookups when the batch query fails', async () => {
    vi.mocked(prisma.user.findMany).mockRejectedValueOnce(new Error('database timeout'))

    await dispatchPostCommentSideEffects({
      comment: { id: 'c-1', content: 'fyi @[Bob](human-2)' },
      task: baseTask,
      commenter: humanCommenter,
    })

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'human-2' },
      select: { id: true, isAIAgent: true, email: true },
    })
    expect(sendCommentNotification).toHaveBeenCalledWith(
      'human-2',
      expect.objectContaining({ type: 'mention' }),
    )
  })

  it('runs workflow action detection on human comments', async () => {
    await dispatchPostCommentSideEffects({
      comment: { id: 'c-1', content: 'ship it' },
      task: baseTask,
      commenter: humanCommenter,
    })
    expect(processCommentForWorkflowAction).toHaveBeenCalledWith('task-1', 'c-1', 'ship it', 'human-1')
  })

  it('skips workflow action detection on AI-agent comments (prevents loops)', async () => {
    await dispatchPostCommentSideEffects({
      comment: { id: 'c-1', content: 'ship it' },
      task: baseTask,
      commenter: { ...humanCommenter, isAIAgent: true },
    })
    expect(processCommentForWorkflowAction).not.toHaveBeenCalled()
  })

  it('wakes up the assignee AI agent when a human comments on an AI-assigned task', async () => {
    assigneeUserIsAgent = true
    await dispatchPostCommentSideEffects({
      comment: { id: 'c-1', content: 'please continue' },
      task: {
        ...baseTask,
        assigneeId: 'agent-claude',
        assignee: {
          email: 'claude@astrid.cc',
          name: 'Claude',
          isAIAgent: true,
          aiAgentType: 'coding_agent',
        },
        lists: [{ id: 'list-1', githubRepositoryId: 'repo-1', aiAgentConfiguredBy: 'human-2' }],
      },
      commenter: humanCommenter,
    })
    // Coding agent path uses AIOrchestrator (mocked); webhook path is the fallback.
    expect(notifyCommentOnAssignedTask).not.toHaveBeenCalled()
  })

  it('skips assignee AI agent wake-up for system-generated comments', async () => {
    assigneeUserIsAgent = true
    await dispatchPostCommentSideEffects({
      comment: {
        id: 'c-1',
        content: 'auto status update <!-- SYSTEM_GENERATED_COMMENT -->',
      },
      task: {
        ...baseTask,
        assigneeId: 'agent-claude',
        assignee: { email: 'claude@astrid.cc', name: 'Claude', isAIAgent: true, aiAgentType: 'coding_agent' },
        lists: [{ id: 'list-1', githubRepositoryId: 'repo-1', aiAgentConfiguredBy: 'human-2' }],
      },
      commenter: humanCommenter,
    })
    expect(notifyCommentOnAssignedTask).not.toHaveBeenCalled()
  })
})
