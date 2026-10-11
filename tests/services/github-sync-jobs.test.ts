/**
 * AWTD-1152 (P4d): the GitHub sync job queue (spec §8.1, §8.7).
 *
 *   - enqueue is one idempotent insert on the coalescing key;
 *   - a drain claims each job with a conditional update, so two drainers never
 *     run one job; a lost claim is skipped;
 *   - a hydrate job re-reads GitHub and applies it to the bound board; an item
 *     GitHub no longer has leaves the board;
 *   - failures back off (or wait out a rate limit); after MAX_ATTEMPTS a job
 *     is dead, its error kept;
 *   - two installations are served fairly within one drain.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const db = vi.hoisted(() => ({
  gitHubSyncJob: { createMany: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  gitHubProjectBinding: { findMany: vi.fn() },
  task: { findUnique: vi.fn(), update: vi.fn((a: unknown) => ({ op: 'task.update', a })) },
  gitHubProjectItem: { upsert: vi.fn((a: unknown) => ({ op: 'item.upsert', a })), findFirst: vi.fn() },
  comment: { findUnique: vi.fn() },
  $transaction: vi.fn(async (ops: unknown) => ops),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const projects = vi.hoisted(() => ({
  boundBoard: vi.fn(),
  boardForProjectNode: vi.fn(),
  applyProjectItems: vi.fn(async () => ({})),
  removeProjectItem: vi.fn(async () => true),
}))
vi.mock('@/services/github-projects.service', () => projects)
vi.mock('@/lib/github/graphql-clients', () => ({ installationGraphqlClient: vi.fn(), userGraphqlClient: vi.fn() }))

const lifecycle = vi.hoisted(() => ({ reconcileProject: vi.fn(async () => ({})), syncBoardRoles: vi.fn(async () => ({})) }))
vi.mock('@/services/github-projects-lifecycle.service', () => lifecycle)

import { drainSyncJobs, enqueueCommentPush, enqueueDueReconciles, enqueueHydrate } from '@/services/github-sync-jobs.service'

vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn() }))
import { MAX_ATTEMPTS } from '@/lib/github/projects/jobs'
import { createBudget, createGraphqlClient, memoryBudgetStore } from '@/lib/github/rate-limiter'

const DIR = join(process.cwd(), 'tests/fixtures/github/graphql')
const load = (name: string) => JSON.parse(readFileSync(join(DIR, name), 'utf8'))
const NOW = new Date('2026-10-10T12:00:00.000Z')
const board = { projectId: 'proj-1', listId: 'list-1', ownerId: 'u', binding: load('binding-graceful-fools.json') }

const replaying = (body: unknown) =>
  createGraphqlClient({
    token: 't',
    bucket: 'installation:1',
    priority: 'hydrate',
    budget: createBudget(memoryBudgetStore()),
    fetch: vi.fn(async () => new Response(JSON.stringify(body))) as never,
  })

const job = (id: string, installationId: number, attempts = 0) => ({
  id,
  kind: 'hydrate',
  installationId,
  attempts,
  payload: { itemNodeId: 'PVTI_lADOFEb-HM4BmXS2zg_2m3Y', projectNodeId: 'PVT_kwDOFEb-HM4BmXS2' },
})

beforeEach(() => {
  vi.clearAllMocks()
  db.gitHubSyncJob.updateMany.mockResolvedValue({ count: 1 })
  projects.boardForProjectNode.mockResolvedValue(board)
})

describe('enqueueHydrate (AWTD-1152)', () => {
  it('is one insert that ignores a duplicate coalescing key', async () => {
    db.gitHubSyncJob.createMany.mockResolvedValue({ count: 1 })
    expect(
      await enqueueHydrate({ installationId: 7, itemNodeId: 'PVTI_x', projectNodeId: 'PVT_y', now: NOW.getTime() }),
    ).toBe(true)
    expect(db.gitHubSyncJob.createMany).toHaveBeenCalledWith({
      data: [
        {
          kind: 'hydrate',
          installationId: 7,
          dedupeKey: `item:PVTI_x:${Math.floor(NOW.getTime() / 2000)}`,
          payload: { itemNodeId: 'PVTI_x', projectNodeId: 'PVT_y' },
        },
      ],
      skipDuplicates: true,
    })
  })

  it('a coalesced duplicate reports false', async () => {
    db.gitHubSyncJob.createMany.mockResolvedValue({ count: 0 })
    expect(await enqueueHydrate({ installationId: 7, itemNodeId: 'PVTI_x', projectNodeId: 'PVT_y' })).toBe(false)
  })
})

describe('drainSyncJobs (AWTD-1152)', () => {
  it('hydrates the item and applies it to the bound board, then marks the job done', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job('j1', 1)])
    const summary = await drainSyncJobs(20, { now: () => NOW, clientFor: () => replaying(load('hydrate-item-draft.json')) })

    expect(summary).toEqual({ claimed: 1, succeeded: 1, failed: 0 })
    expect(projects.applyProjectItems).toHaveBeenCalledWith(board, [
      expect.objectContaining({ id: 'PVTI_lADOFEb-HM4BmXS2zg_2m3Y' }),
    ])
    expect(db.gitHubSyncJob.update).toHaveBeenCalledWith({
      where: { id: 'j1' },
      data: { doneAt: expect.any(Date), lockedUntil: null, error: null },
    })
  })

  it('claims with a conditional update, and skips a job another drainer took', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job('j1', 1)])
    db.gitHubSyncJob.updateMany.mockResolvedValue({ count: 0 })

    expect(await drainSyncJobs(20, { now: () => NOW, clientFor: () => replaying({}) })).toEqual({
      claimed: 0,
      succeeded: 0,
      failed: 0,
    })
    expect(db.gitHubSyncJob.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'j1', doneAt: null })
    expect(projects.applyProjectItems).not.toHaveBeenCalled()
  })

  it('an item GitHub no longer has leaves the board', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job('j1', 1)])
    await drainSyncJobs(20, { now: () => NOW, clientFor: () => replaying(load('hydrate-item-missing.json')) })

    expect(projects.removeProjectItem).toHaveBeenCalledWith(board, 'PVTI_lADOFEb-HM4BmXS2zg_2m3Y')
    expect(projects.applyProjectItems).not.toHaveBeenCalled()
  })

  it('a project no longer bound is done, with nothing to mirror', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job('j1', 1)])
    projects.boardForProjectNode.mockResolvedValue(null)
    const clientFor = vi.fn()

    expect(await drainSyncJobs(20, { now: () => NOW, clientFor })).toMatchObject({ succeeded: 1 })
    expect(projects.applyProjectItems).not.toHaveBeenCalled()
  })

  it('a failure backs off and keeps its error', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job('j1', 1, 2)])
    const before = Date.now()
    await drainSyncJobs(20, {
      now: () => NOW,
      clientFor: () => replaying({ errors: [{ message: 'boom' }] }),
    })

    const data = db.gitHubSyncJob.update.mock.calls[0][0].data
    expect(data).toMatchObject({ lockedUntil: null, error: 'boom' })
    expect(data.doneAt).toBeUndefined()
    // Third attempt: 120s.
    expect(data.runAfter.getTime() - before).toBeGreaterThanOrEqual(119_000)
  })

  it('a rate limit waits until GitHub says, rather than the backoff', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job('j1', 1)])
    await drainSyncJobs(20, {
      now: () => NOW,
      clientFor: () => replaying({ data: null, errors: [{ type: 'RATE_LIMITED', message: 'limit' }] }),
    })
    expect(db.gitHubSyncJob.update.mock.calls[0][0].data.error).toMatch(/budget/)
  })

  it(`after ${MAX_ATTEMPTS} attempts a job is dead: done, with its error`, async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job('j1', 1, MAX_ATTEMPTS - 1)])
    await drainSyncJobs(20, { now: () => NOW, clientFor: () => replaying({ errors: [{ message: 'still broken' }] }) })

    expect(db.gitHubSyncJob.update.mock.calls[0][0].data).toMatchObject({ doneAt: expect.any(Date), error: 'still broken' })
  })

  it('serves two installations fairly: one org’s backlog does not starve the other', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([
      ...Array.from({ length: 30 }, (_, n) => job(`big-${n}`, 1)),
      job('small-0', 2),
    ])
    const summary = await drainSyncJobs(3, { now: () => NOW, clientFor: () => replaying(load('hydrate-item-draft.json')) })

    const claimedIds = db.gitHubSyncJob.updateMany.mock.calls.map(call => call[0].where.id)
    expect(claimedIds).toEqual(['big-0', 'small-0', 'big-1'])
    expect(summary.claimed).toBe(3)
  })

  it('reads only due, unlocked (or lock-expired), unfinished jobs', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([])
    await drainSyncJobs(20, { now: () => NOW })
    expect(db.gitHubSyncJob.findMany.mock.calls[0][0].where).toEqual({
      doneAt: null,
      runAfter: { lte: NOW },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: NOW } }],
    })
  })
})

describe('reconcile and access jobs (AWTD-1153)', () => {
  it('a reconcile job reconciles on the reconcile-priority client (30% cap), then re-derives roles', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([{ id: 'r1', kind: 'reconcile', installationId: 5, attempts: 0, payload: { projectId: 'proj-1' } }])
    const reconcileClient = { query: vi.fn() }
    const reconcileClientFor = vi.fn(() => reconcileClient)
    const userClientFor = vi.fn()

    expect(await drainSyncJobs(20, { now: () => NOW, reconcileClientFor, userClientFor })).toMatchObject({ succeeded: 1 })
    expect(reconcileClientFor).toHaveBeenCalledWith(5)
    expect(lifecycle.reconcileProject).toHaveBeenCalledWith('proj-1', reconcileClient)
    expect(lifecycle.syncBoardRoles).toHaveBeenCalledWith('proj-1', userClientFor)
  })

  it('an access job re-derives roles on every attached board of the installation', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([{ id: 'a1', kind: 'access', installationId: 5, attempts: 0, payload: { installationId: 5 } }])
    db.gitHubProjectBinding.findMany.mockResolvedValue([{ projectId: 'p1' }, { projectId: 'p2' }])

    await drainSyncJobs(20, { now: () => NOW, userClientFor: vi.fn() })
    expect(db.gitHubProjectBinding.findMany.mock.calls[0][0].where).toEqual({ installationId: 5, detachedAt: null })
    expect(lifecycle.syncBoardRoles).toHaveBeenCalledTimes(2)
  })

  it('enqueueDueReconciles: attached boards stale for an hour, one job per project per hour', async () => {
    db.gitHubProjectBinding.findMany.mockResolvedValue([{ projectId: 'p1', installationId: 5 }])
    db.gitHubSyncJob.createMany.mockResolvedValue({ count: 1 })

    expect(await enqueueDueReconciles(NOW.getTime())).toBe(1)
    expect(db.gitHubProjectBinding.findMany.mock.calls[0][0].where).toMatchObject({ detachedAt: null })
    expect(db.gitHubSyncJob.createMany.mock.calls[0][0]).toEqual({
      data: [{ kind: 'reconcile', installationId: 5, dedupeKey: `reconcile:p1:${Math.floor(NOW.getTime() / 3_600_000)}`, payload: { projectId: 'p1' } }],
      skipDuplicates: true,
    })
  })
})

describe('writeback jobs (AWTD-1116 P5b)', () => {
  const content = { remoteNodeId: 'I_new', remoteKind: 'issue', remoteVersion: 'v', identifier: 'o/r#9', itemNodeId: null }
  const job = { id: 'w1', kind: 'writeback', installationId: 5, attempts: 0, payload: { actorId: 'u1', projectId: 'proj-1', content, fields: { statusRole: 'doing' } } }

  it('finishes a half-made create as the same user: item, fields, then the task is synced', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job])
    projects.boundBoard.mockResolvedValue({ ...board, projectNodeId: 'PVT_kwDOFEb-HM4BmXS2' })
    db.task.findUnique.mockResolvedValue({ id: 't9' })
    const sent: string[] = []
    const client = { query: vi.fn(async (q: string) => { sent.push(q); return q.includes('addProjectV2ItemById') ? { m0: { item: { id: 'PVTI_new' } } } : {} }) }
    const writeClientFor = vi.fn(async () => client as never)

    expect(await drainSyncJobs(20, { now: () => NOW, writeClientFor })).toMatchObject({ succeeded: 1 })
    expect(writeClientFor).toHaveBeenCalledWith('u1')
    expect(sent[0]).toMatch(/addProjectV2ItemById/)
    expect(sent[1]).toMatch(/updateProjectV2ItemFieldValue/)
    expect(db.task.update).toHaveBeenCalledWith({ where: { id: 't9' }, data: { syncState: null } })
    expect(db.gitHubProjectItem.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { itemNodeId: 'PVTI_new', projectId: 'proj-1', taskId: 't9' } }))
  })

  it('without the creating user’s token it fails and retries — never the installation', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job])
    projects.boundBoard.mockResolvedValue(board)
    expect(await drainSyncJobs(20, { now: () => NOW, writeClientFor: async () => null })).toMatchObject({ failed: 1 })
    expect(db.gitHubSyncJob.update.mock.calls[0][0].data.error).toMatch(/auth_required/)
  })
})

describe('comments to GitHub (AWTD-1116 P5c)', () => {
  const job = { id: 'c1', kind: 'comment', installationId: 5, attempts: 0, payload: { commentId: 'cm1' } }
  const comment = (over: Record<string, unknown> = {}) => ({
    content: 'Looks good',
    authorId: 'u1',
    type: 'TEXT',
    author: { name: 'Jon', isAIAgent: false },
    task: { remoteNodeId: 'I_kwDOVCns8c8AAAABWTcnYA' },
    ...over,
  })
  const recorder = () => {
    const sent: Array<{ q: string; v: Record<string, unknown> }> = []
    return { sent, client: { query: vi.fn(async (q: string, v: Record<string, unknown>) => (sent.push({ q, v }), {})) } as never }
  }

  it('queues a comment on a mirrored issue, once per comment', async () => {
    db.gitHubProjectItem.findFirst.mockResolvedValue({ binding: { installationId: 5 } })
    db.gitHubSyncJob.createMany.mockResolvedValue({ count: 1 })
    expect(await enqueueCommentPush('cm1', 't1')).toBe(true)
    expect(db.gitHubSyncJob.createMany.mock.calls[0][0].data[0]).toMatchObject({ kind: 'comment', dedupeKey: 'comment:cm1' })
  })

  it('does not queue for a draft or a task on no GitHub board', async () => {
    db.gitHubProjectItem.findFirst.mockResolvedValue(null)
    expect(await enqueueCommentPush('cm1', 't1')).toBe(false)
    expect(db.gitHubProjectItem.findFirst.mock.calls[0][0].where.task).toEqual({ remoteKind: { in: ['issue', 'pull_request'] } })
  })

  it('a person’s comment is posted as them', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job])
    db.comment.findUnique.mockResolvedValue(comment())
    const user = recorder()
    const agentClientFor = vi.fn()
    await drainSyncJobs(20, { now: () => NOW, writeClientFor: async id => (id === 'u1' ? user.client : null), agentClientFor })

    expect(user.sent[0].q).toMatch(/addComment/)
    expect(user.sent[0].v).toEqual({ s: 'I_kwDOVCns8c8AAAABWTcnYA', b: 'Looks good' })
    expect(agentClientFor).not.toHaveBeenCalled()
  })

  it('an agent’s comment goes out as the App bot, prefixed with who said it (§8.6)', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job])
    db.comment.findUnique.mockResolvedValue(comment({ authorId: 'ai-agent-claude', author: { name: 'Claude', isAIAgent: true } }))
    const bot = recorder()
    const writeClientFor = vi.fn()
    await drainSyncJobs(20, { now: () => NOW, writeClientFor, agentClientFor: () => bot.client })

    expect(bot.sent[0].v.b).toMatch(/^\*\*Claude\*\* \(via .+\)\n\nLooks good$/)
    expect(writeClientFor).not.toHaveBeenCalled()
  })

  it('system lines and comments deleted since are not posted', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job])
    db.comment.findUnique.mockResolvedValue(comment({ authorId: null }))
    const user = recorder()
    expect(await drainSyncJobs(20, { now: () => NOW, writeClientFor: async () => user.client })).toMatchObject({ succeeded: 1 })
    expect(user.sent).toHaveLength(0)
  })

  it('a person with no usable token: the job retries, never posting as the installation', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job])
    db.comment.findUnique.mockResolvedValue(comment())
    const agentClientFor = vi.fn()
    expect(await drainSyncJobs(20, { now: () => NOW, writeClientFor: async () => null, agentClientFor })).toMatchObject({ failed: 1 })
    expect(agentClientFor).not.toHaveBeenCalled()
  })
})

describe('agent labels to GitHub (AWTD-1191 P6c-5)', () => {
  const ISSUE = 'I_kwDOVCns8c8AAAABWTcnYA'
  const job = (labels: string[]) => ({
    id: 'al1',
    kind: 'agent_label',
    installationId: 5,
    attempts: 0,
    payload: { remoteNodeId: ISSUE, labels },
  })
  /** The App bot's client, answering each document in order. */
  const bot = (...answers: unknown[]) => {
    const sent: Array<{ q: string; v: Record<string, unknown> }> = []
    const queue = [...answers]
    const query = vi.fn(async (q: string, v: Record<string, unknown>) => (sent.push({ q, v }), queue.shift() ?? {}))
    return { sent, client: { query } as never }
  }

  it('creates the label in the repo when it is missing, then adds it — as the App bot (§8.6)', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job(['agent:claude'])])
    const app = bot(
      { node: { labels: { nodes: [{ id: 'LA_bug', name: 'bug' }] }, repository: { id: 'R_1', l0: null } } },
      { c0: { label: { id: 'LA_new' } } },
    )
    const writeClientFor = vi.fn()
    const agentClientFor = vi.fn(() => app.client)

    expect(await drainSyncJobs(20, { now: () => NOW, writeClientFor, agentClientFor })).toMatchObject({ succeeded: 1 })
    expect(agentClientFor).toHaveBeenCalledWith(5)
    expect(writeClientFor).not.toHaveBeenCalled()
    expect(app.sent[1].q).toMatch(/createLabel/)
    expect(app.sent[1].v).toMatchObject({ r: 'R_1', n0: 'agent:claude' })
    expect(app.sent[2].q).toMatch(/addLabelsToLabelable/)
    expect(app.sent[2].v).toEqual({ id: ISSUE, add: ['LA_new'], remove: [] })
  })

  it('removes the label once no agent is assigned, and leaves every other label', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job([])])
    const onIssue = [
      { id: 'LA_claude', name: 'agent:claude' },
      { id: 'LA_bug', name: 'bug' },
    ]
    const app = bot({ node: { labels: { nodes: onIssue }, repository: { id: 'R_1' } } })

    await drainSyncJobs(20, { now: () => NOW, agentClientFor: () => app.client })
    expect(app.sent).toHaveLength(2)
    expect(app.sent[1].q).toMatch(/removeLabelsFromLabelable/)
    expect(app.sent[1].v).toEqual({ id: ISSUE, add: [], remove: ['LA_claude'] })
  })

  it('writes nothing when the issue already matches, or is gone', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job(['agent:claude'])])
    const onIssue = [{ id: 'LA_claude', name: 'agent:claude' }]
    const matching = bot({ node: { labels: { nodes: onIssue }, repository: { id: 'R_1', l0: { id: 'LA_claude' } } } })
    await drainSyncJobs(20, { now: () => NOW, agentClientFor: () => matching.client })
    expect(matching.sent).toHaveLength(1)

    const gone = bot({ node: null })
    expect(await drainSyncJobs(20, { now: () => NOW, agentClientFor: () => gone.client })).toMatchObject({ succeeded: 1 })
    expect(gone.sent).toHaveLength(1)
  })
})
