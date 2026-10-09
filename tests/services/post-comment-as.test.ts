/**
 * P1 step 4 — agent and system comments go through the comment service.
 *
 * postCommentAs loads the task context the service needs (lists and members for
 * the audience, the assignee for agent wake-up) and hands off to
 * createCommentWithSideEffects, so an agent's comment is broadcast and
 * notified exactly like a person's.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockPrisma } from '../setup'

const { createCommentWithSideEffects } = vi.hoisted(() => ({ createCommentWithSideEffects: vi.fn() }))
vi.mock('@/services/comment.service', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createCommentWithSideEffects,
}))

import { postCommentAs } from '@/services/post-comment-as'

const TASK = {
  id: 'task-1',
  title: 'Ship it',
  creatorId: 'creator-1',
  assigneeId: 'agent-1',
  assignee: { id: 'agent-1', email: 'agent@agents.example', name: 'Agent', isAIAgent: true, aiAgentType: 'claude_agent' },
  lists: [{ id: 'list-1', name: 'Web', ownerId: 'owner-1', listMembers: [{ userId: 'member-1' }], githubRepositoryId: null, aiAgentConfiguredBy: null }],
}

describe('postCommentAs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.task.findUnique.mockResolvedValue(TASK)
    createCommentWithSideEffects.mockResolvedValue({ kind: 'created', comment: { id: 'c1' } })
  })

  it('creates through the comment service with the task context it needs', async () => {
    const result = await postCommentAs({ taskId: 'task-1', authorId: 'agent-1', content: 'Done.' })

    expect(result).toEqual({ ok: true, comment: { id: 'c1' } })
    expect(createCommentWithSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        authorId: 'agent-1',
        content: 'Done.',
        type: 'MARKDOWN',
        task: expect.objectContaining({ id: 'task-1', assigneeId: 'agent-1', lists: TASK.lists }),
      }),
    )
  })

  it('reports a missing task instead of writing', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null)

    const result = await postCommentAs({ taskId: 'gone', authorId: 'agent-1', content: 'x' })

    expect(result).toEqual({ ok: false, error: 'Task not found' })
    expect(createCommentWithSideEffects).not.toHaveBeenCalled()
  })

  it('passes through a refusal from the service', async () => {
    createCommentWithSideEffects.mockResolvedValue({ kind: 'invalid', error: 'Comment content is required' })

    const result = await postCommentAs({ taskId: 'task-1', authorId: 'agent-1', content: '' })

    expect(result).toEqual({ ok: false, error: 'Comment content is required' })
  })
})
