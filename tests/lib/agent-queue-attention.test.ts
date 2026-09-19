/**
 * The loop can hear the board (AWTD-963).
 *
 * `get_agent_queue` answered one question — what may I WORK — and the queue is
 * Ready ∩ assigned ∩ due. So a comment on a task the agent put into Doing was
 * invisible, a comment on one it finished was invisible, and a reply in list
 * chat had no read path in the repo at all: `scripts/post-list-message.ts` is
 * the only chat client and it only writes. Polling mode disables the four
 * server-side dispatch sites on purpose, which is correct — it just means the
 * harness has to PULL what the server no longer pushes.
 *
 * Two things these tests exist to pin, because both are ways of going quietly
 * deaf rather than loudly broken:
 *
 *   - a system event must not swallow a comment. "Jon Paris marked this as
 *     complete" and reassignment notices carry `authorId: null`; if they
 *     counted as "the newest comment", reassigning a task after asking a
 *     question would hide the question forever.
 *   - a missing `chat:read` scope must not look like a quiet channel. The
 *     attention payload says which half it could not read and why, because an
 *     empty inbox and an unread one are different facts.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { mockPrisma } from '@/tests/setup'
import { buildAgentQueue } from '@/lib/agent-queue'

const AGENT = { id: 'agent-claude', name: 'Claude Agent', isAIAgent: true }

const JON = { id: 'user-1', name: 'Jon Paris', isAIAgent: false }

/** A task row as the attention query selects it. */
const attentionTask = (over: Record<string, unknown> = {}) => ({
  id: 'task-9',
  identifier: 'AWTD-9',
  title: 'Something with a question on it',
  statusRole: 'doing',
  completed: false,
  comments: [],
  ...over,
})

const comment = (over: Record<string, unknown> = {}) => ({
  id: 'c-1',
  content: 'Are you sure about the second half of this?',
  createdAt: new Date('2026-09-19T10:00:00Z'),
  updatedAt: new Date('2026-09-19T10:00:00Z'),
  authorId: JON.id,
  author: JON,
  ...over,
})

/** The queue query is first; the attention query is second. */
function attentionQuery() {
  return mockPrisma.task.findMany.mock.calls[1]?.[0]
}

beforeEach(() => {
  mockPrisma.user.findUnique.mockReset()
  mockPrisma.task.findMany.mockReset()
  mockPrisma.chatChannel.findUnique.mockReset()
  mockPrisma.chatMessage.findFirst.mockReset()
  mockPrisma.chatMessage.findMany.mockReset()

  mockPrisma.user.findUnique.mockResolvedValue(AGENT)
  mockPrisma.task.findMany.mockResolvedValue([])
  mockPrisma.chatChannel.findUnique.mockResolvedValue(null)
  mockPrisma.chatMessage.findFirst.mockResolvedValue(null)
  mockPrisma.chatMessage.findMany.mockResolvedValue([])
})

describe('buildAgentQueue attention — task comments (AWTD-963)', () => {
  it('surfaces a task whose newest comment is from a human', async () => {
    mockPrisma.task.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([attentionTask({ comments: [comment()] })])

    const result = await buildAgentQueue({ agent: 'claude', userId: 'user-1' })

    expect(result.attention.tasks).toHaveLength(1)
    expect(result.attention.tasks[0].id).toBe('task-9')
    expect(result.attention.tasks[0].lastComment.authorName).toBe('Jon Paris')
  })

  it('looks past the board lanes: Doing and completed both count', async () => {
    await buildAgentQueue({ agent: 'claude', userId: 'user-1' })

    const where = attentionQuery().where
    // The queue's own filters are exactly what makes it deaf here. An
    // `attention` that re-applied them would answer nothing, always.
    expect(where).not.toHaveProperty('statusRole')
    expect(where).not.toHaveProperty('completed')
  })

  it('still only ever shows tasks assigned to this agent and visible to the caller', async () => {
    await buildAgentQueue({ agent: 'claude', userId: 'user-1', listId: 'list-9' })

    const where = attentionQuery().where
    expect(where.assigneeId).toBe('agent-claude')
    expect(where.lists.some.id).toBe('list-9')
    expect(JSON.stringify(where.lists)).toContain('user-1')
  })

  it('ignores a task whose newest comment is the agent itself — that is answered', async () => {
    mockPrisma.task.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        attentionTask({
          comments: [comment({ authorId: AGENT.id, author: AGENT, content: 'Done — ready to ship.' })],
        }),
      ])

    const result = await buildAgentQueue({ agent: 'claude', userId: 'user-1' })

    expect(result.attention.tasks).toEqual([])
  })

  it('asks the database for the newest AUTHORED comment, so a system event cannot swallow a question', async () => {
    await buildAgentQueue({ agent: 'claude', userId: 'user-1' })

    const commentSelect = attentionQuery().select.comments
    expect(commentSelect.take).toBe(1)
    expect(commentSelect.orderBy).toEqual({ createdAt: 'desc' })
    // `"Jon Paris marked this as complete"` has authorId null. Counting it as
    // the newest comment would hide the question underneath it.
    expect(commentSelect.where).toEqual({ authorId: { not: null } })
  })

  it('reports a truncated inbox rather than silently showing a subset', async () => {
    // A full page means there is more behind it. Whether the loop can DO
    // anything about it is a separate question from whether it is told.
    const many = Array.from({ length: 200 }, (_, i) =>
      attentionTask({ id: `t-${i}`, comments: [comment()] }),
    )
    mockPrisma.task.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(many)

    const result = await buildAgentQueue({ agent: 'claude', userId: 'user-1' })

    expect(result.attention.truncated).toBe(true)
  })
})

describe('buildAgentQueue attention — list chat (AWTD-963)', () => {
  const message = (over: Record<string, unknown> = {}) => ({
    id: 'm-1',
    content: 'did the deploy go out?',
    createdAt: new Date('2026-09-19T12:00:00Z'),
    authorId: JON.id,
    author: JON,
    ...over,
  })

  it('is not read at all without chat:read, and says so rather than reporting silence', async () => {
    const result = await buildAgentQueue({
      agent: 'claude',
      userId: 'user-1',
      listId: 'list-9',
      includeChat: false,
    })

    expect(result.attention.messages).toEqual([])
    // An unread channel and a quiet one are different facts.
    expect(result.attention.skipped.join(' ')).toMatch(/chat:read/)
    expect(mockPrisma.chatChannel.findUnique).not.toHaveBeenCalled()
  })

  it('reads the board channel when the caller does hold chat:read', async () => {
    mockPrisma.chatChannel.findUnique.mockResolvedValue({ id: 'chan-1' })
    mockPrisma.chatMessage.findMany.mockResolvedValue([message()])

    const result = await buildAgentQueue({
      agent: 'claude',
      userId: 'user-1',
      listId: 'list-9',
      includeChat: true,
    })

    expect(mockPrisma.chatChannel.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { listId: 'list-9' } }),
    )
    expect(result.attention.messages).toHaveLength(1)
    expect(result.attention.messages[0].content).toBe('did the deploy go out?')
    expect(result.attention.skipped).toEqual([])
  })

  it('asks the database for the agent LAST message, not the newest one on the page', async () => {
    // A page of recent messages need not contain the agent's own last one.
    // Deducing the watermark from the page would treat a whole quiet channel as
    // unanswered every run.
    mockPrisma.chatChannel.findUnique.mockResolvedValue({ id: 'chan-1' })
    mockPrisma.chatMessage.findFirst.mockResolvedValue({
      createdAt: new Date('2026-09-19T11:00:00Z'),
    })

    await buildAgentQueue({
      agent: 'claude',
      userId: 'user-1',
      listId: 'list-9',
      includeChat: true,
    })

    expect(mockPrisma.chatMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channelId: 'chan-1', authorId: 'agent-claude' },
        orderBy: { createdAt: 'desc' },
      }),
    )
    const where = mockPrisma.chatMessage.findMany.mock.calls[0][0].where
    expect(where.createdAt).toEqual({ gt: new Date('2026-09-19T11:00:00Z') })
    expect(where.authorId).toEqual({ not: 'agent-claude' })
  })

  it('reads nothing when no board was named — there is no channel to read', async () => {
    await buildAgentQueue({ agent: 'claude', userId: 'user-1', includeChat: true })

    expect(mockPrisma.chatChannel.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.chatMessage.findMany).not.toHaveBeenCalled()
  })

  it('treats a list with no channel yet as quiet, not as an error', async () => {
    mockPrisma.chatChannel.findUnique.mockResolvedValue(null)

    const result = await buildAgentQueue({
      agent: 'claude',
      userId: 'user-1',
      listId: 'list-9',
      includeChat: true,
    })

    expect(result.attention.messages).toEqual([])
    expect(result.attention.skipped).toEqual([])
  })
})

describe('buildAgentQueue attention — cost (AWTD-963)', () => {
  it('adds no chat queries to a poll that does not ask for chat', async () => {
    // The property that a quiet tick costs ONE HTTP request is why the
    // scheduled loop is affordable; the inbox must not turn it into a fan-out.
    await buildAgentQueue({ agent: 'claude', userId: 'user-1', listId: 'list-9' })

    expect(mockPrisma.chatMessage.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.chatMessage.findFirst).not.toHaveBeenCalled()
  })
})
