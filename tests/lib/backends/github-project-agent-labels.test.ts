/**
 * AWTD-1191 (P6c-5): assigning an AI agent on a GitHub board queues the
 * `agent:<name>` label for the issue (spec §8.6, §15 C3).
 *
 *   - assigning an agent queues the labels the issue should carry;
 *   - unassigning or reassigning queues the set without it;
 *   - the assignment itself never waits on GitHub or needs a user token;
 *   - a draft has no labels: nothing is queued;
 *   - with the brand capability off (the default), nothing is queued at all.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({
  task: { findUnique: vi.fn() },
  taskList: { findMany: vi.fn(), findFirst: vi.fn() },
  user: { findMany: vi.fn() },
  gitHubSyncJob: { upsert: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { createGithubProjectTaskBackend } from '@/lib/backends/github-project'

const ISSUE = 'I_kwDOVCns8c8AAAABWTcnYA'
const mirrored = (over: Record<string, unknown> = {}) => ({
  remoteNodeId: ISSUE,
  remoteKind: 'issue',
  remoteVersion: '2026-10-10T14:46:32Z',
  title: 'An issue',
  description: 'body',
  completed: false,
  closedReason: null,
  statusRole: 'ready',
  priority: 0,
  dueDateTime: null,
  assigneeId: null,
  assigneeIds: [],
  githubProjectItems: [
    {
      itemNodeId: 'PVTI_1',
      binding: {
        projectId: 'board-1',
        projectNodeId: 'PVT_1',
        installationId: 5,
        detachedAt: null,
        project: { lists: [{ id: 'gh-list' }] },
        statusFieldId: null,
        statusOptionMap: {},
        priorityFieldId: null,
        priorityOptionMap: null,
        dueFieldId: null,
      },
    },
  ],
  ...over,
})

const claude = { id: 'ai-agent-claude', githubNodeId: null, isAIAgent: true, email: 'claude@agents.example', name: 'Claude Agent' }
const codex = { id: 'ai-agent-codex', githubNodeId: null, isAIAgent: true, email: 'codex@agents.example', name: 'Codex Agent' }
const human = { id: 'human-1', githubNodeId: 'U_human1', isAIAgent: false, email: 'h@example.com', name: 'Human' }

const ctx = { actorId: 'u1' }
const noUserToken = async () => null
const backendWith = (agentLabels: boolean, userClient: () => Promise<never | null> = noUserToken) =>
  createGithubProjectTaskBackend({ userClient, agentLabels: () => agentLabels })
const queued = () => db.gitHubSyncJob.upsert.mock.calls.map(call => call[0].create)

beforeEach(() => {
  vi.clearAllMocks()
  db.gitHubSyncJob.upsert.mockResolvedValue({})
})

describe('agent assignment → agent:<name> label (AWTD-1191)', () => {
  it('assigning an agent queues its label, without a user token', async () => {
    db.task.findUnique.mockResolvedValue(mirrored())
    db.user.findMany.mockResolvedValue([claude])

    expect(await backendWith(true).updateTask(ctx, 't1', { assigneeId: 'ai-agent-claude' })).toMatchObject({ ok: true })
    expect(queued()).toHaveLength(1)
    expect(queued()[0]).toMatchObject({
      kind: 'agent_label',
      installationId: 5,
      payload: { remoteNodeId: ISSUE, labels: ['agent:claude'] },
    })
  })

  it('keeps one job per issue, so a later change replaces one that has not run', async () => {
    db.task.findUnique.mockResolvedValue(mirrored())
    db.user.findMany.mockResolvedValue([claude])

    await backendWith(true).updateTask(ctx, 't1', { assigneeId: 'ai-agent-claude' })
    const { where, update } = db.gitHubSyncJob.upsert.mock.calls[0][0]
    expect(where).toEqual({ dedupeKey: `agent-label:${ISSUE}` })
    expect(update).toMatchObject({ payload: { labels: ['agent:claude'] }, doneAt: null, attempts: 0 })
  })

  it('unassigning the agent queues an empty set, which removes the label', async () => {
    db.task.findUnique.mockResolvedValue(mirrored({ assigneeId: 'ai-agent-claude' }))
    db.user.findMany.mockResolvedValue([claude])

    expect(await backendWith(true).updateTask(ctx, 't1', { assigneeId: null })).toMatchObject({ ok: true })
    expect(queued()[0]).toMatchObject({ kind: 'agent_label', payload: { remoteNodeId: ISSUE, labels: [] } })
  })

  it('reassigning from one agent to another queues only the new one', async () => {
    db.task.findUnique.mockResolvedValue(mirrored({ assigneeId: 'ai-agent-claude' }))
    db.user.findMany.mockResolvedValue([claude, codex])

    await backendWith(true).updateTask(ctx, 't1', { assigneeId: 'ai-agent-codex' })
    expect(queued()[0].payload).toEqual({ remoteNodeId: ISSUE, labels: ['agent:codex'] })
  })

  it('reassigning from an agent to a person queues the removal once GitHub took the person', async () => {
    db.task.findUnique.mockResolvedValue(mirrored({ assigneeId: 'ai-agent-claude' }))
    db.user.findMany.mockResolvedValue([claude, human])
    const client = { query: vi.fn(async () => ({ m0: { clientMutationId: null } })) }

    const backend = backendWith(true, async () => client as never)
    expect(await backend.updateTask(ctx, 't1', { assigneeId: 'human-1' })).toMatchObject({ ok: true })
    expect(queued()[0].payload).toEqual({ remoteNodeId: ISSUE, labels: [] })
  })

  it('a write GitHub refuses queues nothing', async () => {
    db.task.findUnique.mockResolvedValue(mirrored({ assigneeId: 'ai-agent-claude' }))
    db.user.findMany.mockResolvedValue([claude, human])

    expect(await backendWith(true).updateTask(ctx, 't1', { assigneeId: 'human-1' })).toMatchObject({ error: 'auth_required' })
    expect(queued()).toHaveLength(0)
  })

  it('a change among people only queues nothing', async () => {
    db.task.findUnique.mockResolvedValue(mirrored())
    db.user.findMany.mockResolvedValue([human])
    const client = { query: vi.fn(async () => ({ m0: { clientMutationId: null } })) }

    await backendWith(true, async () => client as never).updateTask(ctx, 't1', { assigneeId: 'human-1' })
    expect(queued()).toHaveLength(0)
  })

  it('a draft has no labels: the assignment stays in the replica', async () => {
    db.task.findUnique.mockResolvedValue(mirrored({ remoteKind: 'draft', remoteNodeId: 'DI_1' }))
    db.user.findMany.mockResolvedValue([claude])

    expect(await backendWith(true).updateTask(ctx, 't1', { assigneeId: 'ai-agent-claude' })).toMatchObject({ ok: true })
    expect(queued()).toHaveLength(0)
  })

  it('with the capability off, nothing is queued and the write is as before', async () => {
    db.task.findUnique.mockResolvedValue(mirrored())
    db.user.findMany.mockResolvedValue([claude])

    expect(await backendWith(false).updateTask(ctx, 't1', { assigneeId: 'ai-agent-claude' })).toEqual({
      ok: true,
      value: { assigneeId: 'ai-agent-claude' },
    })
    expect(queued()).toHaveLength(0)
  })

  it('GitHub’s own news never queues a label', async () => {
    const backend = backendWith(true)
    await backend.updateTask({ actorId: 'system', origin: 'remote' } as never, 't1', { assigneeId: 'ai-agent-claude' })
    expect(queued()).toHaveLength(0)
  })
})
