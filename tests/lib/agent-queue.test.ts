/**
 * What a polling harness is allowed to work.
 *
 * Two ways this can be wrong, and they fail in opposite directions: too wide and
 * a stranger's loop starts writing code against an untriaged note; too narrow and
 * the queue reads as an idle day while work sits on the board. Both are pinned.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { mockPrisma } from '@/tests/setup'
import { buildAgentQueue, UnknownAgentError } from '@/lib/agent-queue'

const AGENT = { id: 'agent-claude', name: 'Claude Agent', isAIAgent: true }

const task = (over: Record<string, unknown> = {}) => ({
  id: 'task-1',
  identifier: 'AWTD-1',
  title: 'Fix the thing',
  description: null,
  priority: 2,
  dueDateTime: null,
  isAllDay: false,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  lists: [{ id: 'list-1', name: 'Astrid Web To-do', githubRepositoryId: 'owner/repo' }],
  ...over,
})

describe('buildAgentQueue', () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockReset()
    mockPrisma.task.findMany.mockReset()
    mockPrisma.user.findUnique.mockResolvedValue(AGENT)
    mockPrisma.task.findMany.mockResolvedValue([])
  })

  it('refuses to guess which agent is asking', async () => {
    // A loop that guesses claims another harness's work — the one failure mode
    // that costs duplicated effort rather than an empty answer.
    await expect(buildAgentQueue({ agent: '', userId: 'user-1' })).rejects.toBeInstanceOf(
      UnknownAgentError
    )
    await expect(buildAgentQueue({ agent: 'sydney', userId: 'user-1' })).rejects.toBeInstanceOf(
      UnknownAgentError
    )
  })

  it('accepts either a mailbox or a full agent address', async () => {
    const byMailbox = await buildAgentQueue({ agent: 'claude', userId: 'user-1' })
    const byEmail = await buildAgentQueue({ agent: 'CLAUDE@astrid.cc', userId: 'user-1' })
    expect(byMailbox.agent.email).toBe('claude@astrid.cc')
    expect(byEmail.agent.email).toBe('claude@astrid.cc')
  })

  it('answers an empty queue for an identity nobody has used yet', async () => {
    // The agent row is created on first assignment; before that this is a quiet
    // day, not an error a scheduled job should alert on.
    mockPrisma.user.findUnique.mockResolvedValue(null)
    const result = await buildAgentQueue({ agent: 'claude', userId: 'user-1' })
    expect(result.empty).toBe(true)
    expect(result.queue).toEqual([])
    expect(result.agent.id).toBeNull()
  })

  it('asks only for Ready tasks assigned to this agent and visible to the caller', async () => {
    await buildAgentQueue({ agent: 'claude', userId: 'user-1' })

    const where = mockPrisma.task.findMany.mock.calls[0][0].where
    expect(where.assigneeId).toBe('agent-claude')
    expect(where.statusRole).toBe('ready')
    expect(where.completed).toBe(false)
    // Visibility is the CALLER's: a harness must not be handed tasks the person
    // running it could not already read.
    expect(JSON.stringify(where.lists)).toContain('user-1')
  })

  it('scopes to one board when asked, so two harnesses do not cross boards', async () => {
    await buildAgentQueue({ agent: 'claude', userId: 'user-1', listId: 'list-9' })
    const where = mockPrisma.task.findMany.mock.calls[0][0].where
    expect(where.lists.some.id).toBe('list-9')
  })

  it('holds a task dated for later, and says when it becomes workable', async () => {
    const later = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    mockPrisma.task.findMany.mockResolvedValue([
      task({ id: 'now', dueDateTime: null }),
      task({ id: 'later', title: 'Weekly review', dueDateTime: new Date(later) }),
    ])

    const result = await buildAgentQueue({ agent: 'claude', userId: 'user-1' })

    expect(result.queue.map(t => t.id)).toEqual(['now'])
    expect(result.held.notDueCount).toBe(1)
    // A queue held up by the clock must not read as an idle one.
    expect(result.held.scheduled[0]).toMatchObject({ id: 'later', title: 'Weekly review' })
    expect(result.held.scheduled[0].startsAt).not.toBe('')
    expect(result.empty).toBe(false)
  })

  it('reports empty:true when everything queued is waiting on a date', async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      task({ id: 'later', dueDateTime: new Date(Date.now() + 3600_000) }),
    ])
    const result = await buildAgentQueue({ agent: 'claude', userId: 'user-1' })
    expect(result.empty).toBe(true)
    expect(result.queue).toEqual([])
    expect(result.held.notDueCount).toBe(1)
  })

  it('carries the repo and a link, so the loop can act without a second call', async () => {
    mockPrisma.task.findMany.mockResolvedValue([task()])
    const [queued] = (await buildAgentQueue({ agent: 'claude', userId: 'user-1' })).queue
    expect(queued.githubRepositoryId).toBe('owner/repo')
    expect(queued.listName).toBe('Astrid Web To-do')
    expect(queued.url).toContain('task-1')
  })
})
