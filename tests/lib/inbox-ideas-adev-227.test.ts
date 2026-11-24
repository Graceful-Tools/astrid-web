/**
 * ADEV-227: /fixall clarifies Inbox ideas.
 *
 * Jon, 2026-11-23: "The ai can help drive clarity on inbox /ideas." An open
 * Inbox note (no status, not completed) is work for the loop, so a quiet board
 * with new ideas still starts a run. A note already carrying an open agent
 * question is not, or every tick would loop on it waiting for the person.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { mockPrisma } from '@/tests/setup'
import { buildAgentQueue } from '@/lib/agent-queue'
import { awaitsClarification } from '@/lib/inbox-ideas'

const AGENT = { id: 'agent-claude', name: 'Claude Agent', isAIAgent: true }
const JON = { id: 'user-1', name: 'Jon Paris', isAIAgent: false }
const at = (iso: string) => new Date(iso)

const comment = (over: Record<string, unknown> = {}) => ({
  id: 'c-1',
  authorId: JON.id,
  author: JON,
  content: 'A note',
  createdAt: at('2026-11-23T10:00:00Z'),
  updatedAt: at('2026-11-23T10:00:00Z'),
  ...over,
})

const question = comment({
  id: 'q', authorId: AGENT.id, author: AGENT,
  content: '**Decision:** which reading?\n- **1.** Small (recommended)\n- **2.** Large\nAGENT-HANDBACK: claude',
  createdAt: at('2026-11-23T11:00:00Z'), updatedAt: at('2026-11-23T11:00:00Z'),
})

const note = (over: Record<string, unknown> = {}) => ({
  id: 'note-1',
  identifier: 'ADEV-1',
  title: 'Ideas: dark mode for the widget',
  description: '',
  creatorId: JON.id,
  assigneeId: null,
  updatedAt: at('2026-11-23T09:00:00Z'),
  comments: [] as ReturnType<typeof comment>[],
  ...over,
})

describe('awaitsClarification (ADEV-227)', () => {
  it('counts a note nobody has asked about', () => {
    expect(awaitsClarification({ description: '', comments: [] })).toBe(true)
    expect(awaitsClarification({ description: '', comments: [comment()] })).toBe(true)
  })

  it('ignores a note whose latest agent comment is an open AGENT-HANDBACK question', () => {
    expect(awaitsClarification({ description: '', comments: [question, comment()] })).toBe(false)
  })

  it('ignores an answered question too: the resume path owns the reply, not this one', () => {
    const reply = comment({ id: 'r', content: '1 — Small', createdAt: at('2026-11-23T12:00:00Z') })
    expect(awaitsClarification({ description: '', comments: [reply, question] })).toBe(false)
  })

  it('a quoted marker is not a question', () => {
    const quoted = comment({ ...question, content: 'Earlier I wrote AGENT-HANDBACK: claude' })
    expect(awaitsClarification({ description: '', comments: [quoted] })).toBe(true)
  })

  it('leaves public-intake copies to the person who promotes them', () => {
    expect(awaitsClarification({ description: 'Crash on save\n\n[public-intake:abc]', comments: [] })).toBe(false)
  })
})

describe('buildAgentQueue inbox.ideas (ADEV-227)', () => {
  /** The ideas query is the only one that asks for `creatorId`. */
  const isIdeasQuery = (args: { select?: Record<string, unknown> } | undefined) =>
    Boolean(args?.select && 'creatorId' in args.select)

  let ideaRows: unknown[] = []

  beforeEach(() => {
    mockPrisma.user.findUnique.mockReset()
    mockPrisma.task.findMany.mockReset()
    mockPrisma.user.findUnique.mockResolvedValue(AGENT)
    ideaRows = []
    mockPrisma.task.findMany.mockImplementation(async (args: { select?: Record<string, unknown> }) =>
      isIdeasQuery(args) ? ideaRows : [])
  })

  it('lists an unclarified note and leaves out one with an open agent question', async () => {
    ideaRows = [
      note(),
      note({ id: 'note-2', identifier: 'ADEV-2', assigneeId: JON.id, comments: [question] }),
    ]
    const result = await buildAgentQueue({ agent: 'claude', userId: JON.id, listId: 'list-9', includeUnassigned: true })

    expect(result.inbox?.ideas.map(idea => idea.identifier)).toEqual(['ADEV-1'])
    expect(result.inbox?.ideas[0]).toMatchObject({
      id: 'note-1', title: 'Ideas: dark mode for the widget', creatorId: JON.id,
      updatedAt: '2026-11-23T09:00:00.000Z',
    })
  })

  it('asks only for open, unstatused notes on the named board, within membership', async () => {
    await buildAgentQueue({ agent: 'claude', userId: JON.id, listId: 'list-9', includeUnassigned: true })
    const call = mockPrisma.task.findMany.mock.calls.find(([args]) => isIdeasQuery(args))
    expect(call).toBeDefined()
    const where = call![0].where
    expect(where).toMatchObject({ completed: false, statusRole: null })
    expect(where.lists.some.id).toBe('list-9')
    // Membership, not visibility — the same bound as unassigned Ready work.
    expect(JSON.stringify(where.lists)).toContain(JON.id)
    expect(JSON.stringify(where.lists)).toContain(AGENT.id)
    // An Inbox note assigned to another agent is not a person's idea.
    expect(JSON.stringify(where)).toContain('isAIAgent')
  })

  it('is absent without includeUnassigned, and asks nothing', async () => {
    const result = await buildAgentQueue({ agent: 'claude', userId: JON.id, listId: 'list-9' })
    expect(result).not.toHaveProperty('inbox')
    expect(mockPrisma.task.findMany.mock.calls.some(([args]) => isIdeasQuery(args))).toBe(false)
  })

  it('does not make the hosted runnable verdict wake on ideas — the preflight bounds them with seen-keys', async () => {
    ideaRows = [note()]
    const result = await buildAgentQueue({ agent: 'claude', userId: JON.id, listId: 'list-9', includeUnassigned: true })
    expect(result.runnable.hasWork).toBe(false)
  })
})
