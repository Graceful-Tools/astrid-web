/**
 * Replying to a comment must notify the parent comment's author, and prior
 * commenters must hear about new comments (task 9535a5a9).
 *
 * fanOutComment always had explicit logic for both audiences, but its only
 * caller — persistInAppCommentNotifications — never supplied parentAuthorId
 * or commenterIds, so the 'replied' kind was dead end-to-end and anyone who
 * had commented on a task they neither created nor were assigned to was
 * never told about follow-ups.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const persistNotifications = vi.fn(async () => {})

// Comments on task-1: c-parent by user-b, c-prior by user-d, a system comment
// (authorId null), and the new reply c-reply by user-a to c-parent.
const taskComments = [
  { id: 'c-parent', authorId: 'user-b', parentCommentId: null },
  { id: 'c-prior', authorId: 'user-d', parentCommentId: null },
  { id: 'c-system', authorId: null, parentCommentId: null },
  { id: 'c-reply', authorId: 'user-a', parentCommentId: 'c-parent' },
]

vi.mock('@/lib/prisma', () => ({
  prisma: {
    comment: { findMany: vi.fn(async () => taskComments) },
    user: { findUnique: vi.fn(async () => null) },
    codingTaskWorkflow: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'wf-1' })) },
  },
}))

vi.mock('@/lib/notification-store', () => ({
  persistNotifications: (...args: unknown[]) => persistNotifications(...(args as [])),
}))

vi.mock('@/lib/user-stats', () => ({ invalidateUserStats: vi.fn() }))
vi.mock('@/lib/push-notification-service', () => ({
  PushNotificationService: class {
    sendCommentNotification() { return Promise.resolve() }
  },
}))
vi.mock('@/lib/astrid-agent', () => ({ ASTRID_EMAIL: 'astrid@astrid.cc' }))
vi.mock('@/lib/astrid-agent-runtime', () => ({ processAstridComment: vi.fn() }))
vi.mock('@/lib/comment-approval-detector', () => ({ processCommentForWorkflowAction: vi.fn() }))
vi.mock('@/lib/ai-agent-webhook-service', () => ({
  aiAgentWebhookService: { notifyCommentOnAssignedTask: vi.fn() },
}))
vi.mock('@/lib/ai/agent-config', () => ({ getAgentService: () => 'claude' }))

import { dispatchPostCommentSideEffects } from '@/lib/comments/post-comment-side-effects'

const task = {
  id: 'task-1',
  title: 'Do the thing',
  creatorId: 'user-c',
  assigneeId: null,
  assignee: null,
  lists: [{ id: 'list-1' }],
}

const commenter = { id: 'user-a', name: 'Alice', email: 'alice@example.com', isAIAgent: false }

const persistedTargets = () => {
  expect(persistNotifications).toHaveBeenCalledTimes(1)
  const { targets } = (persistNotifications.mock.calls[0] as unknown as [{ targets: Array<{ userId: string; kind: string }> }])[0]
  return targets
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('reply fan-out (task 9535a5a9)', () => {
  it("notifies the parent comment's author with kind 'replied'", async () => {
    await dispatchPostCommentSideEffects({
      comment: { id: 'c-reply', content: 'good point' },
      task,
      commenter,
    })

    expect(persistedTargets()).toContainEqual({ userId: 'user-b', kind: 'replied' })
  })

  it("notifies prior commenters with kind 'commented'", async () => {
    await dispatchPostCommentSideEffects({
      comment: { id: 'c-reply', content: 'good point' },
      task,
      commenter,
    })

    const targets = persistedTargets()
    expect(targets).toContainEqual({ userId: 'user-d', kind: 'commented' })
    // The commenting user never hears about their own comment, and system
    // comments (authorId null) produce no target.
    expect(targets.map(t => t.userId)).not.toContain('user-a')
    expect(targets.map(t => t.userId)).not.toContain(null)
  })
})
