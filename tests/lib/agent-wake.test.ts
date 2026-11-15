/**
 * AWTD-1556: opt-in event-driven wake for polling agents.
 *
 * Spec: docs/architecture/AGENT_EVENT_WAKE.md. Polling stays the reconciliation
 * path, so every assertion here is about latency, never about work: a wake
 * that is not sent costs minutes, and a wake sent twice costs one run that
 * claims nothing.
 *
 *   - an enrolled board queues a wake when a task enters Ready (or is handed to
 *     a polling agent while Ready) and when a human replies to an agent;
 *   - with the master switch off, or the board not enrolled, nothing is queued
 *     and nothing is read;
 *   - a bulk move coalesces to one wake per (board, agent);
 *   - a duplicate wake is harmless: the dispatch is a hint, the worker claims;
 *   - a failed dispatch retries in the job queue and never reaches the write.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { BRAND } = await vi.hoisted(async () => await import('@/lib/brand/config'))

const BOARD = 'board-web'
const OTHER_BOARD = 'board-other'
const NOW = new Date('2026-11-14T12:00:00.000Z')

interface JobRow {
  id: string
  kind: string
  dedupeKey: string | null
  payload: unknown
  attempts: number
  runAfter: Date
  lockedUntil: Date | null
  doneAt: Date | null
  deadAt: Date | null
  lastError: string | null
}

const state = vi.hoisted(() => ({
  jobs: [] as JobRow[],
  seq: 0,
  task: null as null | Record<string, unknown>,
  taskReadFails: false,
  repository: 'Graceful-Tools/astrid-web' as string | null,
  mode: 'polling' as string,
}))

const db = vi.hoisted(() => ({
  task: {
    findUnique: vi.fn(async () => {
      if (state.taskReadFails) throw new Error('connection refused')
      return state.task
    }),
  },
  taskList: {
    findUnique: vi.fn(async () => ({ githubRepositoryId: state.repository })),
  },
  job: {
    createMany: vi.fn(async ({ data }: { data: Array<Partial<JobRow>> }) => {
      let count = 0
      for (const d of data) {
        if (d.dedupeKey && state.jobs.some(r => r.dedupeKey === d.dedupeKey)) continue
        state.jobs.push({
          id: `job-${++state.seq}`,
          kind: d.kind!,
          dedupeKey: d.dedupeKey ?? null,
          payload: d.payload,
          attempts: 0,
          runAfter: d.runAfter ?? new Date(0),
          lockedUntil: null,
          doneAt: null,
          deadAt: null,
          lastError: null,
        })
        count++
      }
      return { count }
    }),
    findMany: vi.fn(async ({ where }: { where: { runAfter: { lte: Date } } }) =>
      state.jobs.filter(j => !j.doneAt && !j.lockedUntil && j.runAfter <= where.runAfter.lte)),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.jobs.find(j => j.id === where.id && !j.doneAt && !j.lockedUntil)
      if (!row) return { count: 0 }
      row.lockedUntil = data.lockedUntil as Date
      row.attempts += 1
      return { count: 1 }
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<JobRow> }) => {
      const row = state.jobs.find(j => j.id === where.id)!
      Object.assign(row, data)
      return row
    }),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/background', async () => (await import('../utils/after-response')).backgroundMock)
vi.mock('@/lib/ai/agent-execution-mode', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/ai/agent-execution-mode')>()),
  getAgentExecutionMode: vi.fn(async () => state.mode),
}))

const github = vi.hoisted(() => ({
  appRequest: vi.fn(async () => ({ data: { id: 4242 } })),
  installationRequest: vi.fn(async () => ({ status: 204 })),
  getInstallationOctokit: vi.fn(),
}))
vi.mock('@/lib/github/app', () => ({
  githubAppConfigured: () => true,
  getGitHubApp: () => ({
    octokit: { request: github.appRequest },
    getInstallationOctokit: github.getInstallationOctokit,
  }),
}))

const { flushAfterResponse, discardAfterResponse } = await import('../utils/after-response')
const wake = await import('@/lib/agent-wake')
const { drainJobs } = await import('@/lib/jobs/queue')
const { JOB_HANDLERS } = await import('@/lib/jobs/handlers')

const agent = (mailbox: string) => ({ email: `${mailbox}@${BRAND.agentEmailDomain}`, isAIAgent: true })
const human = { email: 'jon@example.com', isAIAgent: false }

function storedTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    statusRole: 'ready',
    completed: false,
    completedAt: null,
    creatorId: 'jon',
    assigneeId: 'agent-claude',
    assignee: agent('claude'),
    lists: [{ id: BOARD, ownerId: 'jon', aiAgentConfiguredBy: 'jon' }],
    comments: [],
    ...overrides,
  }
}

const wakeJobs = () => state.jobs.filter(j => j.kind === 'agent-wake')

function enroll(lists = BOARD) {
  vi.stubEnv('ASTRID_AGENT_WAKE', 'on')
  vi.stubEnv('ASTRID_AGENT_WAKE_LISTS', lists)
}

beforeEach(() => {
  state.jobs = []
  state.seq = 0
  state.task = storedTask()
  state.taskReadFails = false
  state.repository = 'Graceful-Tools/astrid-web'
  state.mode = 'polling'
  vi.clearAllMocks()
  github.getInstallationOctokit.mockImplementation(async () => ({ request: github.installationRequest }))
  github.installationRequest.mockImplementation(async () => ({ status: 204 }))
  discardAfterResponse()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const before = { id: 'task-1', statusRole: null, completed: false, assigneeId: 'agent-claude' }
const after = { id: 'task-1', statusRole: 'ready', completed: false, assigneeId: 'agent-claude' }

describe('AWTD-1556: a task becoming runnable wakes its agent', () => {
  it('AWTD-1556: queues one wake when a task enters Ready on an enrolled board', async () => {
    enroll()
    await wake.wakeAgentsForTaskWrite({ before, after })
    expect(wakeJobs()).toHaveLength(1)
    expect(wakeJobs()[0].payload).toEqual({
      listId: BOARD,
      mailbox: 'claude',
      taskId: 'task-1',
      reason: 'ready',
      eventAt: NOW.toISOString(),
    })
  })

  it('AWTD-1556: queues a wake when a Ready task is assigned to a polling agent', async () => {
    enroll()
    await wake.wakeAgentsForTaskWrite({
      before: { ...after, assigneeId: 'jon' },
      after,
    })
    expect(wakeJobs().map(j => (j.payload as { reason: string }).reason)).toEqual(['assigned'])
  })

  it('AWTD-1556: an unassigned Ready task wakes whichever loop claims first', async () => {
    enroll()
    state.task = storedTask({ assigneeId: null, assignee: null })
    await wake.wakeAgentsForTaskWrite({ before: null, after: { ...after, assigneeId: null } })
    expect((wakeJobs()[0].payload as { mailbox: string }).mailbox).toBe(wake.ANY_AGENT_MAILBOX)
  })

  it('AWTD-1556: a Ready task assigned to a person, or to an agent that is not polling, wakes nobody', async () => {
    enroll()
    state.task = storedTask({ assigneeId: 'jon', assignee: human })
    await wake.wakeAgentsForTaskWrite({ before, after: { ...after, assigneeId: 'jon' } })
    state.task = storedTask()
    state.mode = 'webhook'
    await wake.wakeAgentsForTaskWrite({ before, after })
    expect(wakeJobs()).toHaveLength(0)
  })

  it('AWTD-1556: an edit that leaves a task where it was is not an event', async () => {
    enroll()
    await wake.wakeAgentsForTaskWrite({ before: after, after })
    await wake.wakeAgentsForTaskWrite({ before, after: { ...after, statusRole: 'doing' } })
    expect(wakeJobs()).toHaveLength(0)
    expect(db.task.findUnique).not.toHaveBeenCalled()
  })
})

describe('AWTD-1556: a human reply wakes the agent it was said to', () => {
  const handback = {
    id: 'c-question',
    authorId: 'agent-claude',
    author: { isAIAgent: true },
    content: `Which copy should the empty state use?\nAGENT-HANDBACK: claude`,
    createdAt: new Date('2026-11-14T11:00:00.000Z'),
    updatedAt: new Date('2026-11-14T11:00:00.000Z'),
  }
  const reply = {
    id: 'c-reply',
    authorId: 'jon',
    author: { isAIAgent: false },
    content: 'Use the short one.',
    createdAt: new Date('2026-11-14T11:59:00.000Z'),
    updatedAt: new Date('2026-11-14T11:59:00.000Z'),
  }
  const commenter = { id: 'jon', isAIAgent: false }

  it('AWTD-1556: a human reply to an agent handback queues a wake for that agent', async () => {
    enroll()
    state.task = storedTask({
      statusRole: null,
      assigneeId: 'jon',
      assignee: human,
      comments: [reply, handback],
    })
    await wake.wakeAgentsForComment({ taskId: 'task-1', comment: { id: 'c-reply', content: reply.content }, commenter })
    expect(wakeJobs()).toHaveLength(1)
    expect(wakeJobs()[0].payload).toMatchObject({ listId: BOARD, mailbox: 'claude', reason: 'handback-reply' })
  })

  it('AWTD-1556: a human comment on a task a polling agent holds queues a wake', async () => {
    enroll()
    state.task = storedTask({ statusRole: 'doing', comments: [reply] })
    await wake.wakeAgentsForComment({ taskId: 'task-1', comment: { id: 'c-reply', content: reply.content }, commenter })
    expect(wakeJobs()[0].payload).toMatchObject({ mailbox: 'claude', reason: 'reply' })
  })

  it('AWTD-1556: an agent comment, or a system one, wakes nobody', async () => {
    enroll()
    await wake.wakeAgentsForComment({
      taskId: 'task-1',
      comment: { id: 'c-1', content: 'done' },
      commenter: { id: 'agent-claude', isAIAgent: true },
    })
    await wake.wakeAgentsForComment({
      taskId: 'task-1',
      comment: { id: 'c-2', content: 'Moved to Ready <!-- SYSTEM_GENERATED_COMMENT -->' },
      commenter,
    })
    expect(wakeJobs()).toHaveLength(0)
    expect(db.task.findUnique).not.toHaveBeenCalled()
  })

  it('AWTD-1556: a person replying to their own task with no handback wakes nobody', async () => {
    enroll()
    state.task = storedTask({ statusRole: null, assigneeId: 'jon', assignee: human, comments: [reply] })
    await wake.wakeAgentsForComment({ taskId: 'task-1', comment: { id: 'c-reply', content: reply.content }, commenter })
    expect(wakeJobs()).toHaveLength(0)
  })
})

describe('AWTD-1556: off by default', () => {
  it('AWTD-1556: with the master switch unset nothing is queued and nothing is read', async () => {
    vi.stubEnv('ASTRID_AGENT_WAKE_LISTS', BOARD)
    await wake.wakeAgentsForTaskWrite({ before, after })
    await wake.wakeAgentsForComment({ taskId: 'task-1', comment: { id: 'c', content: 'hi' }, commenter: { id: 'jon', isAIAgent: false } })
    expect(wakeJobs()).toHaveLength(0)
    expect(db.task.findUnique).not.toHaveBeenCalled()
  })

  it('AWTD-1556: with the switch on but the board not enrolled nothing is queued', async () => {
    enroll(OTHER_BOARD)
    await wake.wakeAgentsForTaskWrite({ before, after })
    expect(wakeJobs()).toHaveLength(0)
  })

  it('AWTD-1556: the switch is "on" exactly, and an empty list enrolls nothing', () => {
    vi.stubEnv('ASTRID_AGENT_WAKE', 'true')
    vi.stubEnv('ASTRID_AGENT_WAKE_LISTS', BOARD)
    expect(wake.wakeEnrollment(BOARD)).toBeNull()
    vi.stubEnv('ASTRID_AGENT_WAKE', 'on')
    vi.stubEnv('ASTRID_AGENT_WAKE_LISTS', '')
    expect(wake.wakeEnrollment(BOARD)).toBeNull()
    vi.stubEnv('ASTRID_AGENT_WAKE_LISTS', ` ${OTHER_BOARD} , ${BOARD}=Graceful-Tools/astrid-web `)
    expect(wake.wakeEnrollment(BOARD)).toEqual({ listId: BOARD, repository: 'Graceful-Tools/astrid-web' })
    expect(wake.wakeEnrollment(OTHER_BOARD)).toEqual({ listId: OTHER_BOARD, repository: null })
  })
})

describe('AWTD-1556: coalescing and duplicates', () => {
  it('AWTD-1556: a bulk move of 100 tasks to Ready queues one pending wake per (board, agent)', async () => {
    enroll()
    for (let i = 0; i < 100; i++) {
      state.task = storedTask({ id: `task-${i}` })
      await wake.wakeAgentsForTaskWrite({ before: { ...before, id: `task-${i}` }, after: { ...after, id: `task-${i}` } })
    }
    expect(wakeJobs()).toHaveLength(1)
  })

  it('AWTD-1556: another agent on the same board, or the same agent after the window, gets its own wake', async () => {
    enroll()
    await wake.wakeAgentsForTaskWrite({ before, after })
    state.task = storedTask({ assigneeId: null, assignee: null })
    await wake.wakeAgentsForTaskWrite({ before: { ...before, assigneeId: null }, after: { ...after, assigneeId: null } })
    expect(wakeJobs()).toHaveLength(2)
    state.task = storedTask()
    vi.setSystemTime(new Date(NOW.getTime() + wake.WAKE_COALESCE_MS))
    await wake.wakeAgentsForTaskWrite({ before, after })
    expect(wakeJobs()).toHaveLength(3)
  })

  it('AWTD-1556: a duplicate wake is harmless: each dispatch is a hint with no task text, and nothing is written', async () => {
    enroll()
    const payload = { listId: BOARD, mailbox: 'claude', taskId: 'task-1', reason: 'ready' as const, eventAt: NOW.toISOString() }
    await JOB_HANDLERS['agent-wake'](payload)
    await JOB_HANDLERS['agent-wake'](payload)
    expect(github.installationRequest).toHaveBeenCalledTimes(2)
    for (const [route, params] of github.installationRequest.mock.calls as unknown as Array<[string, Record<string, unknown>]>) {
      expect(route).toBe('POST /repos/{owner}/{repo}/dispatches')
      expect(params).toEqual({
        owner: 'Graceful-Tools',
        repo: 'astrid-web',
        event_type: 'astrid-wake',
        client_payload: { task_id: 'task-1', mailbox: 'claude', reason: 'ready', event_at: NOW.toISOString() },
      })
    }
    // The worker claims atomically (claim-fixall, AWTD-1555); the wake never
    // touches task state, so a second one can only start a run that finds nothing.
    expect(db.task.findUnique).not.toHaveBeenCalled()
  })

  it('AWTD-1556: the enrollment repository override wins over the board setting', async () => {
    enroll(`${BOARD}=Example-Org/worker`)
    await JOB_HANDLERS['agent-wake']({ listId: BOARD, mailbox: 'claude', taskId: 't', reason: 'ready', eventAt: NOW.toISOString() })
    expect(github.appRequest).toHaveBeenCalledWith('GET /repos/{owner}/{repo}/installation', { owner: 'Example-Org', repo: 'worker' })
    expect(db.taskList.findUnique).not.toHaveBeenCalled()
  })

  it('AWTD-1556: a wake queued before the switch was turned off is dropped, not sent', async () => {
    await JOB_HANDLERS['agent-wake']({ listId: BOARD, mailbox: 'claude', taskId: 't', reason: 'ready', eventAt: NOW.toISOString() })
    expect(github.installationRequest).not.toHaveBeenCalled()
  })
})

describe('AWTD-1556: failure never reaches the write', () => {
  it('AWTD-1556: a failed dispatch retries in the job queue instead of failing anything', async () => {
    enroll()
    await wake.wakeAgentsForTaskWrite({ before, after })
    github.installationRequest.mockRejectedValue(new Error('HttpError: Bad credentials'))
    // The drain enqueueJob starts after the response.
    await flushAfterResponse()
    // A second drain before the backoff has elapsed leaves it alone.
    expect(await drainJobs({ now: () => NOW })).toMatchObject({ claimed: 0 })
    const job = wakeJobs()[0]
    expect(job.attempts).toBe(1)
    expect(job.doneAt).toBeNull()
    expect(job.lastError).toContain('Bad credentials')
    expect(job.runAfter.getTime()).toBeGreaterThan(NOW.getTime())
  })

  it('AWTD-1556: a board with no repository to wake fails the job, which the cron still covers', async () => {
    enroll()
    state.repository = null
    await expect(
      JOB_HANDLERS['agent-wake']({ listId: BOARD, mailbox: 'claude', taskId: 't', reason: 'ready', eventAt: NOW.toISOString() }),
    ).rejects.toThrow(/repository/)
  })

  it('AWTD-1556: the task-write and comment hooks resolve even when the database read throws', async () => {
    enroll()
    state.taskReadFails = true
    await expect(wake.wakeAgentsForTaskWrite({ before, after })).resolves.toBeUndefined()
    await expect(
      wake.wakeAgentsForComment({ taskId: 'task-1', comment: { id: 'c', content: 'hi' }, commenter: { id: 'jon', isAIAgent: false } }),
    ).resolves.toBeUndefined()
    expect(wakeJobs()).toHaveLength(0)
  })
})
