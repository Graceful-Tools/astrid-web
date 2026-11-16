// @vitest-environment node
/**
 * AWTD-1694 — requesting and deciding approvals: bound to one commit, only the policy's escalation
 * targets decide, an approval dispatches once and a reply in words never approves.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn() },
    comment: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
  },
}))
vi.mock('@/services/comment.service', () => ({ broadcastCommentCreated: vi.fn(), COMMENT_INCLUDE: {} }))
vi.mock('@/services/orchestration-policy.service', () => ({ effectivePolicyForList: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { effectivePolicyForList } from '@/services/orchestration-policy.service'
import { decideApproval, requestApproval } from '@/services/approval.service'
import { defaultOrchestrationPolicy } from '@/lib/orchestration-policy'
import { APPROVAL_APPROVED, APPROVAL_DECLINED, approvalRequestMarker } from '@/lib/approvals'

const SHA = 'b'.repeat(40)
const OTHER_SHA = 'c'.repeat(40)

const task = {
  id: 't1', title: 'Task', creatorId: 'creator', assigneeId: 'claude-agent',
  lists: [{
    id: 'l1', name: 'Board', ownerId: 'owner', privacy: 'PRIVATE', githubRepositoryId: 'Graceful-Tools/astrid-web',
    listMembers: [{ userId: 'owner', role: 'admin' }, { userId: 'bystander', role: 'member' }, { userId: 'claude-agent', role: 'member' }],
  }],
}

const requestInput = { taskId: 't1', userId: 'claude-agent', authorId: 'claude-agent', agent: 'claude', action: 'migrate', sha: SHA, summary: 'DROP COLUMN x' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.task.findUnique).mockResolvedValue(task as never)
  vi.mocked(effectivePolicyForList).mockResolvedValue(defaultOrchestrationPolicy())
  vi.mocked(prisma.comment.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.comment.create).mockImplementation((async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new', createdAt: new Date(), content: '', ...data })) as never)
})

describe('requestApproval (AWTD-1694)', () => {
  it('posts a card bound to the action and the full commit, marked by the server', async () => {
    const result = await requestApproval(requestInput)
    expect(result).toEqual({ ok: true, value: { commentId: 'new', created: true } })
    const data = vi.mocked(prisma.comment.create).mock.calls[0][0].data as { systemEventType: string; content: string }
    expect(data.systemEventType).toBe(approvalRequestMarker('migrate', SHA))
    expect(data.content).toContain(SHA)
    expect(data.content).toContain('DROP COLUMN x')
  })

  it('refuses an abbreviated sha, an unknown action and an empty summary', async () => {
    expect(await requestApproval({ ...requestInput, sha: SHA.slice(0, 7) })).toMatchObject({ ok: false, status: 400 })
    expect(await requestApproval({ ...requestInput, action: 'merge' })).toMatchObject({ ok: false, status: 400 })
    expect(await requestApproval({ ...requestInput, summary: '  ' })).toMatchObject({ ok: false, status: 400 })
    expect(prisma.comment.create).not.toHaveBeenCalled()
  })

  it('does not ask when the policy lets the agent do it alone', async () => {
    const policy = defaultOrchestrationPolicy()
    policy.autonomy.deploy = 'allowed'
    vi.mocked(effectivePolicyForList).mockResolvedValue(policy)
    expect(await requestApproval({ ...requestInput, action: 'deploy' })).toMatchObject({ ok: false, status: 409 })
  })

  it('answers the open card instead of posting a second for the same commit', async () => {
    vi.mocked(prisma.comment.findMany).mockResolvedValue([{ id: 'open', systemEventType: approvalRequestMarker('migrate', SHA), parentCommentId: null }] as never)
    expect(await requestApproval(requestInput)).toEqual({ ok: true, value: { commentId: 'open', created: false } })
    expect(prisma.comment.create).not.toHaveBeenCalled()
  })

  it('refuses a caller who cannot see the task', async () => {
    expect(await requestApproval({ ...requestInput, userId: 'stranger' })).toMatchObject({ ok: false, status: 404 })
  })
})

describe('decideApproval (AWTD-1694)', () => {
  const decide = { taskId: 't1', requestId: 'req', userName: 'Owner', decision: 'approve' }
  const dispatch = vi.fn()

  beforeEach(() => {
    dispatch.mockReset().mockResolvedValue({ ok: true })
    vi.mocked(prisma.comment.findFirst).mockResolvedValue({ id: 'req', systemEventType: approvalRequestMarker('migrate', SHA) } as never)
  })

  it('records who approved and dispatches the deploy for the bound commit only', async () => {
    vi.mocked(prisma.comment.findMany).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'new' }] as never)
    const result = await decideApproval({ ...decide, userId: 'owner' }, dispatch)
    expect(result).toEqual({ ok: true, value: { decisionId: 'new', status: 'approved', dispatched: true } })
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('Graceful-Tools/astrid-web', SHA)
    const data = vi.mocked(prisma.comment.create).mock.calls[0][0].data as Record<string, unknown>
    expect(data).toMatchObject({ authorId: 'owner', parentCommentId: 'req', systemEventType: APPROVAL_APPROVED })
  })

  it('refuses someone the policy does not name, and runs nothing', async () => {
    const result = await decideApproval({ ...decide, userId: 'bystander' }, dispatch)
    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(dispatch).not.toHaveBeenCalled()
    expect(prisma.comment.create).not.toHaveBeenCalled()
  })

  it('names the people the policy chose instead of the list owner', async () => {
    const policy = defaultOrchestrationPolicy()
    policy.escalation = { to: 'people', userIds: ['bystander'] }
    vi.mocked(effectivePolicyForList).mockResolvedValue(policy)
    vi.mocked(prisma.comment.findMany).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'new' }] as never)
    expect(await decideApproval({ ...decide, userId: 'owner' }, dispatch)).toMatchObject({ ok: false, status: 403 })
    expect(await decideApproval({ ...decide, userId: 'bystander' }, dispatch)).toMatchObject({ ok: true })
  })

  it('a decline records the reason, runs nothing and leaves the task alone', async () => {
    vi.mocked(prisma.comment.findMany).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'new' }] as never)
    const result = await decideApproval({ ...decide, userId: 'owner', decision: 'decline', reason: 'wait for Friday' }, dispatch)
    expect(result).toMatchObject({ ok: true, value: { status: 'declined', dispatched: false } })
    const data = vi.mocked(prisma.comment.create).mock.calls[0][0].data as { systemEventType: string; content: string }
    expect(data.systemEventType).toBe(APPROVAL_DECLINED)
    expect(data.content).toContain('wait for Friday')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('refuses a second decision: the first stands and nothing dispatches twice', async () => {
    vi.mocked(prisma.comment.findMany).mockResolvedValueOnce([{ id: 'earlier' }] as never)
    expect(await decideApproval({ ...decide, userId: 'owner' }, dispatch)).toMatchObject({ ok: false, status: 409 })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('withdraws its decision when a concurrent one won, and dispatches nothing', async () => {
    vi.mocked(prisma.comment.findMany).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'winner' }, { id: 'new' }] as never)
    expect(await decideApproval({ ...decide, userId: 'owner' }, dispatch)).toMatchObject({ ok: false, status: 409 })
    expect(prisma.comment.delete).toHaveBeenCalledWith({ where: { id: 'new' } })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('says so on the thread when main moved and the deploy did not start', async () => {
    vi.mocked(prisma.comment.findMany).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'new' }] as never)
    dispatch.mockResolvedValue({ ok: false, reason: 'main_moved', message: `main is now ${OTHER_SHA.slice(0, 8)}` })
    const result = await decideApproval({ ...decide, userId: 'owner' }, dispatch)
    expect(result).toMatchObject({ ok: false, status: 409 })
    const last = vi.mocked(prisma.comment.create).mock.calls.at(-1)![0].data as { content: string }
    expect(last.content).toContain('did not start')
  })

  it('only decides a request on this task, never a plain comment', async () => {
    vi.mocked(prisma.comment.findFirst).mockResolvedValue(null)
    expect(await decideApproval({ ...decide, userId: 'owner' }, dispatch)).toMatchObject({ ok: false, status: 404 })
  })
})
