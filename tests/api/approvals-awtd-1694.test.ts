/**
 * AWTD-1694 — approvals over v1: a card is server-made and bound to a commit; only an escalation
 * target decides; Approve dispatches the deploy for that commit; a reply is never an approval.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth-middleware')>('@/lib/api-auth-middleware')
  return { ...actual, authenticateAPI: vi.fn(), requireScopes: vi.fn(), requireTaskAccess: vi.fn() }
})

const dispatch = vi.fn()
const octokit = { request: dispatch }
vi.mock('@/lib/github/app', () => ({
  githubAppConfigured: vi.fn(() => true),
  getGitHubApp: vi.fn(() => ({
    octokit: { request: vi.fn(async () => ({ data: { id: 99 } })) },
    getInstallationOctokit: vi.fn(async () => octokit),
  })),
}))

vi.mock('@/lib/task-identifier', () => ({ resolveTaskIdOrIdentifier: vi.fn(async (id: string) => id) }))
vi.mock('@/lib/ai-agent-author', () => ({
  validateMcpAgentSelection: vi.fn(() => null),
  resolveAgentAuthor: vi.fn(async () => ({ ok: true, authorId: 'ai-agent-claude' })),
}))

const prismaMock = vi.hoisted(() => {
  const comment = { findFirst: vi.fn(), create: vi.fn() }
  return {
    comment,
    task: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ comment })),
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { POST as requestCard } from '@/app/api/v1/tasks/[id]/approvals/route'
import { POST as decideCard } from '@/app/api/v1/tasks/[id]/approvals/[commentId]/route'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { buildApprovalRequestContent } from '@/lib/approvals'

const SHA = 'b'.repeat(40)
const CARD = { id: 'card-1', content: buildApprovalRequestContent({ action: 'migrate', sha: SHA }, 'Runs the deploy.') }

function as(id: string, isAIAgent = false) {
  vi.mocked(authenticateAPI).mockResolvedValue({
    userId: id, source: 'session', scopes: ['*'], isAIAgent,
    user: { id, email: `${id}@example.test`, name: id, isAIAgent }, agentUser: null,
  } as never)
}

const post = (body: unknown) =>
  new NextRequest('http://localhost/api/v1/tasks/t1/approvals', { method: 'POST', body: JSON.stringify(body) })

const ctx = { params: Promise.resolve({ id: 't1' }) }
const decideCtx = { params: Promise.resolve({ id: 't1', commentId: 'card-1' }) }

function task(policy: unknown = null) {
  return {
    id: 't1', creatorId: 'creator', completed: false,
    lists: [{ id: 'l1', ownerId: 'owner', githubRepositoryId: 'Graceful-Tools/astrid-web', orchestrationPolicy: policy, project: null }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks keeps queued `Once` answers a test never consumed (a refusal before the lookup).
  prismaMock.comment.findFirst.mockReset()
  prismaMock.task.findUnique.mockResolvedValue(task())
  prismaMock.comment.findFirst.mockResolvedValue(null)
  prismaMock.comment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new', ...data }))
})

describe('POST /api/v1/tasks/:id/approvals (AWTD-1694)', () => {
  it('posts a server-marked card bound to the action and commit', async () => {
    as('claude-agent', true)
    const res = await requestCard(post({ action: 'migrate', sha: SHA, summary: 'Runs the deploy.' }), ctx)
    expect(res.status).toBe(201)
    expect(prismaMock.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          systemEventType: 'APPROVAL_REQUEST',
          authorId: 'ai-agent-claude',
          content: `Runs the deploy.\n\nAPPROVAL-REQUEST: migrate ${SHA}`,
        }),
      }),
    )
  })

  it('refuses a short sha and an unknown action', async () => {
    as('claude-agent', true)
    expect((await requestCard(post({ action: 'migrate', sha: 'abc', summary: 'x' }), ctx)).status).toBe(400)
    expect((await requestCard(post({ action: 'rm-rf', sha: SHA, summary: 'x' }), ctx)).status).toBe(400)
  })

  it('does not post a second card for the same action and commit while the first is open', async () => {
    as('claude-agent', true)
    prismaMock.comment.findFirst.mockResolvedValue({ id: 'card-1', replies: [] })
    const res = await requestCard(post({ action: 'migrate', sha: SHA, summary: 'Runs the deploy.' }), ctx)
    expect(res.status).toBe(200)
    expect(prismaMock.comment.create).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/tasks/:id/approvals/:commentId (AWTD-1694)', () => {
  beforeEach(() => {
    // 1st lookup: the card; 2nd (inside the transaction): an earlier decision.
    prismaMock.comment.findFirst.mockResolvedValueOnce(CARD).mockResolvedValueOnce(null)
  })

  it('lets the escalation target approve, and dispatches the deploy for the card commit', async () => {
    as('owner')
    const res = await decideCard(post({ decision: 'approve' }), decideCtx)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ verdict: 'approve', dispatched: true })
    expect(prismaMock.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ systemEventType: 'APPROVAL_APPROVED', authorId: 'owner', parentCommentId: 'card-1' }),
      }),
    )
    expect(dispatch).toHaveBeenCalledWith(
      'POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches',
      expect.objectContaining({
        owner: 'Graceful-Tools',
        repo: 'astrid-web',
        workflow_id: 'production-deployment.yml',
        ref: 'main',
        inputs: { skip_tests: 'false', allow_destructive_migrations: 'true', expected_sha: SHA },
      }),
    )
  })

  it('refuses someone the policy does not name, and runs nothing', async () => {
    as('member')
    const res = await decideCard(post({ decision: 'approve' }), decideCtx)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'NOT_AN_APPROVER' })
    expect(prismaMock.comment.create).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('refuses an agent, even one listed as an escalation target', async () => {
    prismaMock.task.findUnique.mockResolvedValue(task({ escalation: { to: 'people', userIds: ['claude-agent'] } }))
    as('claude-agent', true)
    const res = await decideCard(post({ decision: 'approve' }), decideCtx)
    expect(res.status).toBe(403)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('follows the policy’s named people', async () => {
    prismaMock.task.findUnique.mockResolvedValue(task({ escalation: { to: 'people', userIds: ['lead'] } }))
    as('owner')
    expect((await decideCard(post({ decision: 'approve' }), decideCtx)).status).toBe(403)
  })

  it('declines with a reason, leaves the task open and runs nothing', async () => {
    as('owner')
    const res = await decideCard(post({ decision: 'decline', reason: 'code step is not live yet' }), decideCtx)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ verdict: 'decline', dispatched: false })
    expect(prismaMock.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          systemEventType: 'APPROVAL_DECLINED',
          content: expect.stringContaining('code step is not live yet'),
        }),
      }),
    )
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('needs a reason to decline', async () => {
    as('owner')
    expect((await decideCard(post({ decision: 'decline' }), decideCtx)).status).toBe(400)
  })

  it('decides once: a second tap is a conflict and dispatches nothing', async () => {
    prismaMock.comment.findFirst.mockReset()
    prismaMock.comment.findFirst.mockResolvedValueOnce(CARD).mockResolvedValueOnce({ id: 'earlier' })
    as('owner')
    const res = await decideCard(post({ decision: 'approve' }), decideCtx)
    expect(res.status).toBe(409)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does not treat an ordinary comment as a card', async () => {
    prismaMock.comment.findFirst.mockReset()
    prismaMock.comment.findFirst.mockResolvedValue(null) // the lookup requires systemEventType APPROVAL_REQUEST
    as('owner')
    const res = await decideCard(post({ decision: 'approve' }), decideCtx)
    expect(res.status).toBe(404)
    expect(prismaMock.comment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ systemEventType: 'APPROVAL_REQUEST' }) }),
    )
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('says on the card when the approved deploy could not start', async () => {
    as('owner')
    dispatch.mockRejectedValueOnce(new Error('403 Resource not accessible by integration'))
    const res = await decideCard(post({ decision: 'approve' }), decideCtx)
    expect(res.status).toBe(502)
    expect(prismaMock.comment.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ content: expect.stringContaining('did not start') }) }),
    )
  })
})
