/**
 * What a polling harness is allowed to work.
 *
 * Two ways this can be wrong, and they fail in opposite directions: too wide and
 * a stranger's loop starts writing code against an untriaged note; too narrow and
 * the queue reads as an idle day while work sits on the board. Both are pinned.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mockPrisma } from '@/tests/setup'
import { BadQueueOptionError, buildAgentQueue, UnknownAgentError } from '@/lib/agent-queue'
import { BRAND } from '@/lib/brand/config'
import { getTaskUrl } from '@/lib/base-url'

const { shadowInfo, deferred } = vi.hoisted(() => ({
  shadowInfo: vi.fn(),
  deferred: [] as Array<() => Promise<unknown>>,
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: shadowInfo, warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/lib/background', () => ({
  runAfterResponse: (_label: string, work: () => Promise<unknown>) => { deferred.push(work) },
}))

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

describe('AWTD-1554 queue shadow', () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockReset().mockImplementation(async query =>
      'email' in query.where ? AGENT : { mcpSettings: JSON.stringify({ agentModes: { codex: 'off' } }) },
    )
    mockPrisma.task.findMany.mockReset().mockResolvedValue([task()])
    shadowInfo.mockClear()
    deferred.length = 0
    vi.stubEnv('ASTRID_AGENT_EXECUTION_MODE_SHADOW', 'false')
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('keeps serialized queue output byte-identical while observing stored Off', async () => {
    const options = { agent: 'codex', userId: 'user-1' }
    const before = JSON.stringify(await buildAgentQueue(options))
    expect(mockPrisma.user.findUnique).toHaveBeenCalledOnce()
    expect(deferred).toHaveLength(0)
    vi.stubEnv('ASTRID_AGENT_EXECUTION_MODE_SHADOW', 'true')
    const after = JSON.stringify(await buildAgentQueue(options))
    expect(after).toBe(before)
    expect(JSON.parse(after)).toMatchObject({ mode: 'polling', queue: [{ id: 'task-1' }] })
    // Scheduling observation has not read settings or held up queue construction.
    expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(2)
    expect(shadowInfo).not.toHaveBeenCalled()
    await deferred[0]()
    expect(shadowInfo).toHaveBeenCalledWith(
      { userIdHash: expect.any(String), mailbox: 'codex' },
      'agent execution mode shadow mismatch',
    )
    expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(3)
    expect(mockPrisma.user.findUnique.mock.calls[2][0]).toEqual({
      where: { id: options.userId },
      select: { mcpSettings: true },
    })
  })

  it.skip('enforcement follow-up: stored Off polling-only mailbox receives no queued work', async () => {
    const result = await buildAgentQueue({
      agent: 'codex',
      userId: 'user-1',
    })
    expect(result.mode).toBe('off')
    expect(result.queue).toEqual([])
  })
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

  it('AWTD-1560 adds a runnable verdict without changing the existing empty response', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null)

    const result = await buildAgentQueue({ agent: 'claude', userId: 'user-1' })
    const { runnable: _runnable, ...legacyResponse } = result

    expect(legacyResponse).toEqual({
      agent: {
        mailbox: 'claude',
        email: `claude@${BRAND.agentEmailDomain}`,
        id: null,
      },
      mode: 'polling',
      empty: true,
      queue: [],
      held: { notDueCount: 0, notReadyCount: 0, scheduled: [] },
      truncated: false,
      attention: { tasks: [], messages: [], truncated: false, skipped: [] },
      hint: 'No incomplete tasks are assigned to claude. A task is queued only when it is BOTH assigned to claude and in Ready status.',
    })
    expect(result.runnable).toEqual({
      version: 1,
      hasWork: false,
      reasons: [],
      incomplete: false,
    })
  })

  it('AWTD-1560 names Ready as the runnable reason', async () => {
    mockPrisma.task.findMany.mockResolvedValue([task()])

    const result = await buildAgentQueue({
      agent: 'claude',
      userId: 'user-1',
      includeChat: true,
    })

    expect(result.runnable).toEqual({
      version: 1,
      hasWork: true,
      reasons: ['ready'],
      incomplete: false,
    })
  })

  it('AWTD-1560 snapshots the existing Ready response fields unchanged', async () => {
    mockPrisma.task.findMany.mockResolvedValue([task()])

    const result = await buildAgentQueue({
      agent: 'claude',
      userId: 'user-1',
      includeChat: true,
    })
    const { runnable: _runnable, ...legacyResponse } = result

    expect(legacyResponse).toEqual({
      agent: {
        mailbox: 'claude',
        email: `claude@${BRAND.agentEmailDomain}`,
        id: AGENT.id,
        name: AGENT.name,
      },
      mode: 'polling',
      empty: false,
      hint: undefined,
      queue: [{
        id: 'task-1',
        identifier: 'AWTD-1',
        title: 'Fix the thing',
        description: null,
        priority: 2,
        dueDateTime: null,
        listId: 'list-1',
        listName: 'Astrid Web To-do',
        githubRepositoryId: 'owner/repo',
        assigned: true,
        url: getTaskUrl('task-1'),
      }],
      held: { notDueCount: 0, notReadyCount: 0, scheduled: [] },
      truncated: false,
      attention: { tasks: [], messages: [], truncated: false, skipped: [] },
    })
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

describe('buildAgentQueue — due-first selection (AWTD-1559)', () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockReset()
    mockPrisma.task.findMany.mockReset()
    mockPrisma.task.count.mockReset()
    mockPrisma.user.findUnique.mockResolvedValue(AGENT)
    mockPrisma.task.count.mockResolvedValue(500)
  })

  it('returns a due task beyond 500 future tasks when due-first mode is on', async () => {
    const previousMode = process.env.AGENT_QUEUE_DUE_FIRST
    process.env.AGENT_QUEUE_DUE_FIRST = 'on'

    try {
      const dueTask = task({ id: 'due', dueDateTime: new Date(Date.now() - 60_000) })
      const futureTasks = Array.from({ length: 500 }, (_, index) =>
        task({
          id: `future-${index}`,
          dueDateTime: new Date(Date.now() + 60 * 60_000),
        })
      )

      mockPrisma.task.findMany.mockImplementation(async args => {
        if (args.where.comments) return []
        const where = JSON.stringify(args.where)
        if (where.includes('"lte"')) return [dueTask]
        if (where.includes('"gt"')) return futureTasks
        return futureTasks
      })

      const result = await buildAgentQueue({ agent: 'claude', userId: 'user-1' })

      expect(result.queue.map(({ id }) => id)).toEqual(['due'])
      expect(result.truncated).toBe(false)
      expect(result.held.notDueCount).toBe(500)
      expect(result.held.scheduled).toHaveLength(500)
      expect(mockPrisma.task.findMany.mock.calls[0][0]).toMatchObject({
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        take: 501,
      })
    } finally {
      if (previousMode === undefined) delete process.env.AGENT_QUEUE_DUE_FIRST
      else process.env.AGENT_QUEUE_DUE_FIRST = previousMode
    }
  })

  it('reports truncation based on due tasks, not future tasks', async () => {
    const previousMode = process.env.AGENT_QUEUE_DUE_FIRST
    process.env.AGENT_QUEUE_DUE_FIRST = 'on'

    try {
      const dueTasks = Array.from({ length: 501 }, (_, index) =>
        task({ id: `due-${index}`, dueDateTime: new Date(Date.now() - 60_000) })
      )
      mockPrisma.task.findMany.mockImplementation(async args => {
        if (args.where.comments) return []
        return JSON.stringify(args.where).includes('"lte"') ? dueTasks : []
      })

      const result = await buildAgentQueue({ agent: 'claude', userId: 'user-1' })

      expect(result.queue).toHaveLength(500)
      expect(result.truncated).toBe(true)
      expect(result.held.notDueCount).toBe(500)
      expect(result.held.scheduled).toEqual([])
    } finally {
      if (previousMode === undefined) delete process.env.AGENT_QUEUE_DUE_FIRST
      else process.env.AGENT_QUEUE_DUE_FIRST = previousMode
    }
  })

  it('uses the independent scheduled summary in the empty-queue hint', async () => {
    const previousMode = process.env.AGENT_QUEUE_DUE_FIRST
    process.env.AGENT_QUEUE_DUE_FIRST = 'on'

    try {
      const futureTask = task({
        id: 'future',
        title: 'Scheduled work',
        dueDateTime: new Date(Date.now() + 60 * 60_000),
      })
      mockPrisma.task.findMany.mockImplementation(async args => {
        if (args.where.comments) return []
        return JSON.stringify(args.where).includes('"gt"') ? [futureTask] : []
      })
      mockPrisma.task.count.mockImplementation(async args =>
        JSON.stringify(args.where).includes('"gt"') ? 1 : 0
      )

      const result = await buildAgentQueue({ agent: 'claude', userId: 'user-1' })

      expect(result.empty).toBe(true)
      expect(result.held.scheduled.map(({ id }) => id)).toEqual(['future'])
      expect(result.hint).toMatch(/date|scheduled|start/i)
    } finally {
      if (previousMode === undefined) delete process.env.AGENT_QUEUE_DUE_FIRST
      else process.env.AGENT_QUEUE_DUE_FIRST = previousMode
    }
  })

  it.each([0, 1, 499, 500, 501])('keeps off-mode paging unchanged for %i due tasks', async count => {
    const previousMode = process.env.AGENT_QUEUE_DUE_FIRST
    if (count === 0) delete process.env.AGENT_QUEUE_DUE_FIRST
    else process.env.AGENT_QUEUE_DUE_FIRST = 'off'

    try {
      const queuedTasks = Array.from({ length: count }, (_, index) => task({ id: `task-${index}` }))
      mockPrisma.task.findMany.mockReset()
      mockPrisma.task.findMany.mockResolvedValue([])
      mockPrisma.task.findMany.mockResolvedValueOnce(queuedTasks.slice(0, 500))
      mockPrisma.task.count.mockReset()
      mockPrisma.task.count.mockResolvedValue(0)

      const result = await buildAgentQueue({ agent: 'claude', userId: 'user-1' })
      const query = mockPrisma.task.findMany.mock.calls[0][0]

      expect(query.take).toBe(500)
      expect(query.where.dueDateTime).toBeUndefined()
      expect(result.queue.map(({ id }) => id)).toEqual(
        queuedTasks.slice(0, 500).map(({ id }) => id)
      )
      expect(result.truncated).toBe(count >= 500)
      expect(result.held.notDueCount).toBe(0)
    } finally {
      if (previousMode === undefined) delete process.env.AGENT_QUEUE_DUE_FIRST
      else process.env.AGENT_QUEUE_DUE_FIRST = previousMode
    }
  })

  it('rejects an invalid due-first mode rather than silently changing behavior', async () => {
    const previousMode = process.env.AGENT_QUEUE_DUE_FIRST
    process.env.AGENT_QUEUE_DUE_FIRST = 'enabled'

    try {
      await expect(buildAgentQueue({ agent: 'claude', userId: 'user-1' }))
        .rejects.toThrow('AGENT_QUEUE_DUE_FIRST must be off, shadow, or on')
    } finally {
      if (previousMode === undefined) delete process.env.AGENT_QUEUE_DUE_FIRST
      else process.env.AGENT_QUEUE_DUE_FIRST = previousMode
    }
  })

  it('returns the legacy queue in shadow mode while comparing due-first results', async () => {
    const previousMode = process.env.AGENT_QUEUE_DUE_FIRST
    process.env.AGENT_QUEUE_DUE_FIRST = 'shadow'

    try {
      const futureTasks = Array.from({ length: 500 }, (_, index) =>
        task({
          id: `future-${index}`,
          dueDateTime: new Date(Date.now() + 60 * 60_000),
        })
      )
      const dueTask = task({ id: 'due', dueDateTime: new Date(Date.now() - 60_000) })
      mockPrisma.task.findMany.mockImplementation(async args => {
        if (args.where.comments) return []
        const where = JSON.stringify(args.where)
        if (where.includes('"lte"')) return [dueTask]
        if (where.includes('"gt"')) return futureTasks
        return futureTasks
      })
      mockPrisma.task.count.mockImplementation(async args =>
        JSON.stringify(args.where).includes('"gt"') ? 500 : 0
      )

      const result = await buildAgentQueue({ agent: 'claude', userId: 'user-1' })

      expect(result.queue).toEqual([])
      expect(result.truncated).toBe(true)
      expect(result.held.notDueCount).toBe(500)
      expect(result.held.scheduled).toHaveLength(500)
      expect(mockPrisma.task.findMany).toHaveBeenCalledTimes(4)
    } finally {
      if (previousMode === undefined) delete process.env.AGENT_QUEUE_DUE_FIRST
      else process.env.AGENT_QUEUE_DUE_FIRST = previousMode
    }
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

/**
 * /fixall on a board kept for agents — unassigned Ready tasks queue too.
 *
 * Ready is the hand-off there, and requiring an assignment first left Ready work
 * sitting unworked. It stays opt-in and bounded: a named board the caller owns or
 * belongs to, Ready only, and never Doing — that is a peer session's claim.
 */
describe('buildAgentQueue — includeUnassigned', () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockReset()
    mockPrisma.task.findMany.mockReset()
    mockPrisma.task.count.mockReset()
    mockPrisma.user.findUnique.mockResolvedValue(AGENT)
    mockPrisma.task.findMany.mockResolvedValue([])
    mockPrisma.task.count.mockResolvedValue(0)
  })

  it('is off by default, so the queue still requires assignment', async () => {
    await buildAgentQueue({ agent: 'claude', userId: 'user-1', listId: 'list-9' })
    const where = mockPrisma.task.findMany.mock.calls[0][0].where
    expect(where.assigneeId).toBe('agent-claude')
    expect(where.OR).toBeUndefined()
  })

  it('refuses without a board — unassigned and visible includes every public list', async () => {
    await expect(
      buildAgentQueue({ agent: 'claude', userId: 'user-1', includeUnassigned: true })
    ).rejects.toBeInstanceOf(BadQueueOptionError)
    expect(mockPrisma.task.findMany).not.toHaveBeenCalled()
  })

  it('queues unassigned Ready tasks on a board the caller belongs to, alongside assigned ones', async () => {
    await buildAgentQueue({
      agent: 'claude',
      userId: 'user-1',
      listId: 'list-9',
      includeUnassigned: true,
    })
    const where = mockPrisma.task.findMany.mock.calls[0][0].where
    expect(where.completed).toBe(false)
    const [assigned, unassigned] = where.OR
    expect(assigned.assigneeId).toBe('agent-claude')
    expect(assigned.statusRole).toBe('ready')
    expect(unassigned.assigneeId).toBeNull()
    // Ready only: Doing is a peer's claim, Waiting is parked.
    expect(unassigned.statusRole).toBe('ready')
    expect(unassigned.lists.some.id).toBe('list-9')
    // Membership, not visibility: public alone is not enough.
    expect(JSON.stringify(unassigned.lists)).not.toContain('PUBLIC')
    expect(JSON.stringify(unassigned.lists)).toContain('user-1')
  })

  it('keeps unassigned tasks Ready-only even when requireReady is relaxed', async () => {
    await buildAgentQueue({
      agent: 'claude',
      userId: 'user-1',
      listId: 'list-9',
      includeUnassigned: true,
      requireReady: false,
    })
    const [assigned, unassigned] = mockPrisma.task.findMany.mock.calls[0][0].where.OR
    expect(assigned.OR).toEqual([{ statusRole: 'ready' }, { statusRole: null }])
    expect(unassigned.statusRole).toBe('ready')
  })

  it('marks which queued tasks are unassigned, so the loop claims before it works', async () => {
    mockPrisma.task.findMany.mockResolvedValueOnce([
      task({ id: 'mine', assigneeId: 'agent-claude' }),
      task({ id: 'open', assigneeId: null }),
    ])
    const result = await buildAgentQueue({
      agent: 'claude',
      userId: 'user-1',
      listId: 'list-9',
      includeUnassigned: true,
    })
    expect(result.queue.map(t => [t.id, t.assigned])).toEqual([
      ['mine', true],
      ['open', false],
    ])
  })
})
