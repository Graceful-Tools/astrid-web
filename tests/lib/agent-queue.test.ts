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
import { BRAND } from '@/lib/brand/config'

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
    const byEmail = await buildAgentQueue({ agent: `CLAUDE@${BRAND.agentEmailDomain}`, userId: 'user-1' })
    expect(byMailbox.agent.email).toBe(`claude@${BRAND.agentEmailDomain}`)
    expect(byEmail.agent.email).toBe(`claude@${BRAND.agentEmailDomain}`)
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

/**
 * Why the queue is empty (AWTD-845, task ba1a4c4c).
 *
 * `get_agent_queue` requires TWO conditions — assigned to the agent, and Ready —
 * and a caller who meets only the first gets `empty: true` forever with nothing
 * saying which one is missing. That is the failure Joey hit following the
 * published setup: a dozen tasks assigned to `claude`, all `statusRole: null`,
 * and a queue that reads exactly like a quiet day.
 *
 * The module already refuses to let a queue held by the CLOCK look idle. This is
 * the same rule for the other condition, so the tests are the same shape.
 */
describe('buildAgentQueue — saying which condition is unmet', () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockReset()
    mockPrisma.task.findMany.mockReset()
    mockPrisma.task.count.mockReset()
    mockPrisma.user.findUnique.mockResolvedValue(AGENT)
    mockPrisma.task.findMany.mockResolvedValue([])
    mockPrisma.task.count.mockResolvedValue(0)
  })

  it('names Ready as the missing condition when tasks are assigned but not Ready', async () => {
    mockPrisma.task.count.mockResolvedValue(12)

    const result = await buildAgentQueue({ agent: 'claude', userId: 'user-1' })

    expect(result.empty).toBe(true)
    expect(result.held.notReadyCount).toBe(12)
    // The count alone is a number to interpret. Say what to do about it.
    expect(result.hint).toMatch(/12/)
    expect(result.hint).toMatch(/Ready/)
  })

  it('counts not-Ready work with the same assignment and visibility rules as the queue', async () => {
    // A count drawn more widely than the queue would report work the caller
    // cannot see, and send them looking for a task that is not theirs.
    mockPrisma.task.count.mockResolvedValue(3)
    await buildAgentQueue({ agent: 'claude', userId: 'user-1', listId: 'list-9' })

    const where = mockPrisma.task.count.mock.calls[0][0].where
    expect(where.assigneeId).toBe('agent-claude')
    expect(where.completed).toBe(false)
    // Explicitly including NULL is the point: every task in the reported
    // failure had statusRole: null, and a filter that missed them would report
    // "nothing is assigned" for the exact case the count explains.
    expect(where.OR).toEqual([{ statusRole: null }, { statusRole: { not: 'ready' } }])
    expect(where.lists.some.id).toBe('list-9')
    expect(JSON.stringify(where.lists)).toContain('user-1')
  })

  it('blames the clock, not Ready, when the queue is held by a start date', async () => {
    // The two holds are different problems with different fixes. Reporting the
    // wrong one sends a user to change a status that is already correct.
    mockPrisma.task.findMany.mockResolvedValue([
      task({ id: 'later', dueDateTime: new Date(Date.now() + 3600_000) }),
    ])

    const result = await buildAgentQueue({ agent: 'claude', userId: 'user-1' })

    expect(result.empty).toBe(true)
    expect(result.hint).toMatch(/date|scheduled|start/i)
    expect(result.hint).not.toMatch(/Ready/)
  })

  it('says nothing is assigned when nothing is assigned', async () => {
    const result = await buildAgentQueue({ agent: 'claude', userId: 'user-1' })
    expect(result.empty).toBe(true)
    expect(result.held.notReadyCount).toBe(0)
    expect(result.hint).toMatch(/assigned/i)
    expect(result.hint).toMatch(/claude/)
  })

  it('says nothing is assigned for an identity nobody has used yet', async () => {
    // No agent row means no assignment has ever happened. Same unmet condition,
    // and it must not report a bare empty queue just because it returns early.
    mockPrisma.user.findUnique.mockResolvedValue(null)
    const result = await buildAgentQueue({ agent: 'claude', userId: 'user-1' })
    expect(result.hint).toMatch(/assigned/i)
    expect(result.held.notReadyCount).toBe(0)
  })

  it('stays silent, and asks nothing extra, when there is work to do', async () => {
    // The hot path is a loop waking up on a schedule. A queue with work in it
    // needs no explanation, and must not pay for a second query to produce one.
    mockPrisma.task.findMany.mockResolvedValue([task()])

    const result = await buildAgentQueue({ agent: 'claude', userId: 'user-1' })

    expect(result.empty).toBe(false)
    expect(result.hint).toBeUndefined()
    expect(mockPrisma.task.count).not.toHaveBeenCalled()
  })
})

/**
 * AWTD-871 — the queue for someone who does not use the board.
 *
 * Ready is a board state. Someone who never opens a board never sets one, so every
 * task they assign to their agent is `statusRole: null` and the queue reads as a
 * quiet day forever — while the hint tells them to go and use the feature they do
 * not use. `requireReady: false` is the way out, and it relaxes exactly one thing:
 * the ABSENCE of a status stops disqualifying a task. A status that IS set still
 * means what it says.
 */
describe('buildAgentQueue — requireReady', () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockReset()
    mockPrisma.task.findMany.mockReset()
    mockPrisma.task.count.mockReset()
    mockPrisma.user.findUnique.mockResolvedValue(AGENT)
    mockPrisma.task.findMany.mockResolvedValue([])
    mockPrisma.task.count.mockResolvedValue(0)
  })

  it('defaults to requiring Ready, so no existing loop changes behaviour', async () => {
    await buildAgentQueue({ agent: 'claude', userId: 'user-1' })
    const where = mockPrisma.task.findMany.mock.calls[0][0].where
    expect(where.statusRole).toBe('ready')
    expect(where.OR).toBeUndefined()
  })

  it('asks for Ready OR unstatused when Ready is not required', async () => {
    await buildAgentQueue({ agent: 'claude', userId: 'user-1', requireReady: false })

    const where = mockPrisma.task.findMany.mock.calls[0][0].where
    // Null has to be named explicitly: `{ in: ['ready'] }` does not match NULL in
    // SQL, and the whole population this flag exists for is NULL.
    expect(where.OR).toEqual([{ statusRole: 'ready' }, { statusRole: null }])
    // And the narrow filter must be GONE, not merely joined by an OR that a
    // stricter top-level key would still AND away to nothing.
    expect(where.statusRole).toBeUndefined()
  })

  it('still refuses Waiting and Doing when Ready is not required', async () => {
    // The brake stays on. A blocked task parked in Waiting must not come back
    // into the queue merely because its owner does not use the Ready column.
    await buildAgentQueue({ agent: 'claude', userId: 'user-1', requireReady: false })
    const where = mockPrisma.task.findMany.mock.calls[0][0].where
    const matched = JSON.stringify(where.OR)
    expect(matched).not.toContain('waiting')
    expect(matched).not.toContain('doing')
  })

  it('keeps every other condition — assignment, visibility, board and the clock', async () => {
    // Relaxing status must not relax the handshake. An unassigned task is still
    // somebody's untriaged note, on any board, under either flag.
    mockPrisma.task.findMany.mockResolvedValue([
      task({ id: 'later', dueDateTime: new Date(Date.now() + 3600_000) }),
    ])

    const result = await buildAgentQueue({
      agent: 'claude',
      userId: 'user-1',
      listId: 'list-9',
      requireReady: false,
    })

    const where = mockPrisma.task.findMany.mock.calls[0][0].where
    expect(where.assigneeId).toBe('agent-claude')
    expect(where.completed).toBe(false)
    expect(where.lists.some.id).toBe('list-9')
    expect(JSON.stringify(where.lists)).toContain('user-1')
    // A dated task is still not work for today.
    expect(result.queue).toEqual([])
    expect(result.held.notDueCount).toBe(1)
  })

  it('offers requireReady:false as the second way out of a not-Ready queue', async () => {
    // The old hint had one cure for this and it was "use the board". Someone who
    // does not use the board needs to be told the other one exists.
    mockPrisma.task.count.mockResolvedValue(12)

    const result = await buildAgentQueue({ agent: 'claude', userId: 'user-1' })

    expect(result.hint).toMatch(/Ready/)
    expect(result.hint).toMatch(/requireReady/)
  })

  it('counts only DELIBERATELY parked work when Ready is already not required', async () => {
    // With the flag off, an unstatused task is queued rather than held — so
    // counting it as "not Ready" would report a hold that is not happening and
    // send the caller to fix a status that is already fine.
    mockPrisma.task.count.mockResolvedValue(0)
    await buildAgentQueue({ agent: 'claude', userId: 'user-1', requireReady: false })

    const where = mockPrisma.task.count.mock.calls[0][0].where
    expect(where.OR).toBeUndefined()
    expect(where.statusRole).toEqual({ not: null })
  })

  it('does not tell a caller who already passed requireReady:false to set Ready', async () => {
    // They have opted out of the requirement. Naming it as the unmet condition
    // would be advice to change something that is not stopping anything.
    mockPrisma.task.count.mockResolvedValue(4)

    const result = await buildAgentQueue({ agent: 'claude', userId: 'user-1', requireReady: false })

    expect(result.empty).toBe(true)
    expect(result.held.notReadyCount).toBe(4)
    expect(result.hint).not.toMatch(/requireReady/)
    expect(result.hint).toMatch(/Waiting|Doing|status/i)
  })
})
