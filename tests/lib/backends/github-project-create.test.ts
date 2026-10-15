/**
 * AWTD-1116 P5b: creating a task on a GitHub board.
 *
 *   - an issue in the default repo (or a draft), added to the project, fields
 *     set — three requests, all on the ACTING user's client;
 *   - an impossible lane is refused before anything exists on GitHub;
 *   - exit criterion: an outbox replayed twice creates ONE issue;
 *   - a replay while the first is in flight is a 409, not a second issue;
 *   - content made but fields failed → kept as syncState 'pending' + writeback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Prisma } from '@prisma/client'

/** An in-memory GitHubSyncJob table with a unique dedupeKey, like the real one. */
const outbox = vi.hoisted(() => new Map<string, Record<string, unknown>>())
const db = vi.hoisted(() => ({
  taskList: { findFirst: vi.fn() },
  user: { findMany: vi.fn() },
  gitHubSyncJob: {
    upsert: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { createGithubProjectTaskBackend } from '@/lib/backends/github-project'
import { createBudget, createGraphqlClient, memoryBudgetStore } from '@/lib/github/rate-limiter'

const load = (name: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/github/graphql', name), 'utf8'))
const binding = load('binding-graceful-fools.json')

const boardWith = (defaultRepoNodeId: string | null) => ({
  project: {
    githubBinding: {
      projectId: 'board-1',
      projectNodeId: 'PVT_kwDOFEb-HM4BmXS2',
      installationId: 169651419,
      detachedAt: null,
      defaultRepoNodeId,
      ...binding,
    },
  },
})

const OK_FIELDS = { data: { m0: { projectV2Item: { id: 'x' } } } }

function userClient(...bodies: unknown[]) {
  const sent: string[] = []
  const queue = [...bodies]
  const client = createGraphqlClient({
    token: 'ghu_ACTING_USER',
    bucket: 'user:u1',
    priority: 'write',
    budget: createBudget(memoryBudgetStore()),
    fetch: vi.fn(async (_u: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).authorization).toBe('bearer ghu_ACTING_USER')
      sent.push(JSON.parse(String(init.body)).query)
      const body = queue.shift()
      return new Response(JSON.stringify(body), { status: body === 'FAIL' ? 502 : 200 })
    }) as never,
  })
  return { client, sent }
}

const data = (over: Record<string, unknown> = {}) => ({
  title: 'From Astrid',
  description: 'hello',
  statusRole: 'doing',
  priority: 0,
  lists: { connect: [{ id: 'gh-list' }] },
  ...over,
})
const ctx = { actorId: 'u1' }
const mutations = (sent: string[]) => sent.flatMap(q => [...q.matchAll(/m\d+: (\w+)\(/g)].map(m => m[1]))

beforeEach(() => {
  vi.clearAllMocks()
  outbox.clear()
  db.taskList.findFirst.mockResolvedValue(boardWith('R_kgDOVCns8Q'))
  db.gitHubSyncJob.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    if (outbox.has(data.dedupeKey as string)) {
      throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' })
    }
    outbox.set(data.dedupeKey as string, { ...data })
    return data
  })
  db.gitHubSyncJob.findUnique.mockImplementation(async ({ where }: { where: { dedupeKey: string } }) => outbox.get(where.dedupeKey) ?? null)
  db.gitHubSyncJob.update.mockImplementation(async ({ where, data }: { where: { dedupeKey: string }; data: Record<string, unknown> }) => {
    outbox.set(where.dedupeKey, { ...outbox.get(where.dedupeKey), ...data })
  })
  db.gitHubSyncJob.updateMany.mockImplementation(async ({ where, data }: { where: { dedupeKey: string; lockedUntil: { lt: Date } }; data: Record<string, unknown> }) => {
    const row = outbox.get(where.dedupeKey)
    if (!row || (row.lockedUntil as Date) >= where.lockedUntil.lt) return { count: 0 }
    outbox.set(where.dedupeKey, { ...row, ...data })
    return { count: 1 }
  })
  db.gitHubSyncJob.deleteMany.mockImplementation(async ({ where }: { where: { dedupeKey: string } }) => {
    outbox.delete(where.dedupeKey)
    return { count: 1 }
  })
})

describe('create on a GitHub board (AWTD-1116 P5b)', () => {
  it('an issue: create, add to project, set fields — as the user — and the row carries GitHub’s identity', async () => {
    const { client, sent } = userClient(load('create-issue.json'), load('create-add-item.json'), OK_FIELDS)
    const backend = createGithubProjectTaskBackend({ userClient: async () => client })

    const result = await backend.createTask(ctx, data())

    expect(mutations(sent)).toEqual(['createIssue', 'addProjectV2ItemById', 'updateProjectV2ItemFieldValue'])
    expect(result).toMatchObject({
      ok: true,
      value: {
        title: 'From Astrid',
        remoteNodeId: 'I_kwDOVCns8c8AAAABWUFWOA',
        remoteKind: 'issue',
        identifier: 'Graceful-Fools/wordlesolver#3',
        isPrivate: false,
        syncState: null,
        githubProjectItems: { create: [{ itemNodeId: 'PVTI_lADOFEb-HM4BmXS2zg_3Njc', projectId: 'board-1' }] },
      },
    })
  })

  it('a board with no default repo creates a draft, which comes with its item', async () => {
    db.taskList.findFirst.mockResolvedValue(boardWith(null))
    const { client, sent } = userClient(load('create-draft.json'), OK_FIELDS)
    const backend = createGithubProjectTaskBackend({ userClient: async () => client })

    const result = await backend.createTask(ctx, data())
    expect(mutations(sent)).toEqual(['addProjectV2DraftIssue', 'updateProjectV2ItemFieldValue'])
    expect(result).toMatchObject({ ok: true, value: { remoteKind: 'draft', identifier: null, remoteNodeId: 'DI_lADOFEb-HM4BmXS2zgLViGU' } })
  })

  describe('created already assigned to an agent (AWTD-1191)', () => {
    const claude = { email: 'claude@agents.example', name: 'Claude Agent' }
    const assigned = () => data({ assigneeId: 'ai-agent-claude' })

    it('an issue queues its agent:<name> label when the brand mirrors agents', async () => {
      db.user.findMany.mockResolvedValue([claude])
      const { client } = userClient(load('create-issue.json'), load('create-add-item.json'), OK_FIELDS)
      const backend = createGithubProjectTaskBackend({ userClient: async () => client, agentLabels: () => true })

      expect(await backend.createTask(ctx, assigned())).toMatchObject({ ok: true })
      expect(db.gitHubSyncJob.upsert.mock.calls[0][0].create).toMatchObject({
        kind: 'agent_label',
        installationId: 169651419,
        payload: { remoteNodeId: 'I_kwDOVCns8c8AAAABWUFWOA', labels: ['agent:claude'] },
      })
    })

    it('a draft queues nothing, and neither does a brand that does not mirror agents', async () => {
      db.user.findMany.mockResolvedValue([claude])
      db.taskList.findFirst.mockResolvedValue(boardWith(null))
      const draft = userClient(load('create-draft.json'), OK_FIELDS)
      await createGithubProjectTaskBackend({ userClient: async () => draft.client, agentLabels: () => true }).createTask(ctx, assigned())

      db.taskList.findFirst.mockResolvedValue(boardWith('R_kgDOVCns8Q'))
      const issue = userClient(load('create-issue.json'), load('create-add-item.json'), OK_FIELDS)
      await createGithubProjectTaskBackend({ userClient: async () => issue.client }).createTask(ctx, assigned())

      expect(db.gitHubSyncJob.upsert).not.toHaveBeenCalled()
    })
  })

  it('a lane the board cannot hold is refused before anything exists on GitHub', async () => {
    const userClientFn = vi.fn()
    const backend = createGithubProjectTaskBackend({ userClient: userClientFn })
    expect(await backend.createTask(ctx, data({ statusRole: 'custom-x' }))).toEqual({
      ok: false,
      status: 400,
      error: 'github_no_option_for_role',
    })
    expect(userClientFn).not.toHaveBeenCalled()
  })

  it('no usable user token → auth_required', async () => {
    const backend = createGithubProjectTaskBackend({ userClient: async () => null })
    expect(await backend.createTask(ctx, data())).toEqual({ ok: false, status: 403, error: 'auth_required' })
  })

  it('exit: an outbox replayed twice creates ONE issue', async () => {
    const first = userClient(load('create-issue.json'), load('create-add-item.json'), OK_FIELDS)
    const second = userClient()
    let calls = 0
    const backend = createGithubProjectTaskBackend({ userClient: async () => (calls++ === 0 ? first.client : second.client) })
    const offline = data({ clientRequestId: 'offline-req-0001' })

    const a = await backend.createTask(ctx, offline)
    const b = await backend.createTask(ctx, offline)

    expect(mutations(first.sent).filter(m => m === 'createIssue')).toHaveLength(1)
    expect(second.sent).toHaveLength(0)
    expect(b).toMatchObject({ ok: true, value: { remoteNodeId: (a as unknown as { value: { remoteNodeId: string } }).value.remoteNodeId } })
  })

  it('a replay while the first create is still in flight is a 409, not a second issue', async () => {
    outbox.set('create:offline-req-0002', { dedupeKey: 'create:offline-req-0002', payload: {}, lockedUntil: new Date(Date.now() + 60_000) })
    const { client, sent } = userClient()
    const backend = createGithubProjectTaskBackend({ userClient: async () => client })

    expect(await backend.createTask(ctx, data({ clientRequestId: 'offline-req-0002' }))).toEqual({
      ok: false,
      status: 409,
      error: 'create_in_progress',
    })
    expect(sent).toHaveLength(0)
  })

  it('an abandoned attempt (lock expired, no answer recorded) may be retried', async () => {
    outbox.set('create:offline-req-0003', { dedupeKey: 'create:offline-req-0003', payload: {}, lockedUntil: new Date(Date.now() - 1000) })
    const { client, sent } = userClient(load('create-issue.json'), load('create-add-item.json'), OK_FIELDS)
    const backend = createGithubProjectTaskBackend({ userClient: async () => client })

    expect(await backend.createTask(ctx, data({ clientRequestId: 'offline-req-0003' }))).toMatchObject({ ok: true })
    expect(mutations(sent)[0]).toBe('createIssue')
  })

  it('the content failing leaves nothing behind: the claim is released for a retry', async () => {
    const { client } = userClient('FAIL')
    const backend = createGithubProjectTaskBackend({ userClient: async () => client })

    expect(await backend.createTask(ctx, data({ clientRequestId: 'offline-req-0004' }))).toEqual({
      ok: false,
      status: 502,
      error: 'upstream_unavailable',
    })
    expect(outbox.has('create:offline-req-0004')).toBe(false)
  })

  it('content made but the fields failed → kept as pending, with a writeback job to finish it', async () => {
    const { client } = userClient(load('create-issue.json'), load('create-add-item.json'), 'FAIL')
    const backend = createGithubProjectTaskBackend({ userClient: async () => client })

    const result = await backend.createTask(ctx, data())
    expect(result).toMatchObject({ ok: true, value: { syncState: 'pending', remoteNodeId: 'I_kwDOVCns8c8AAAABWUFWOA' } })
    expect(db.gitHubSyncJob.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          kind: 'writeback',
          dedupeKey: 'writeback:I_kwDOVCns8c8AAAABWUFWOA',
          payload: expect.objectContaining({ actorId: 'u1', projectId: 'board-1', fields: { statusRole: 'doing', priority: 0 } }),
        }),
      ],
      skipDuplicates: true,
    })
  })
})
