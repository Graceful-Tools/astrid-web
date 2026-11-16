/**
 * AWTD-1688 — the agent claim for every board: no env flag, a lease on every
 * claim, `heartbeat` to renew it, and client-credentials tokens that name the
 * agent they claim for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { BRAND } from '@/lib/brand/config'

vi.mock('@/lib/api-auth-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth-middleware')>('@/lib/api-auth-middleware')
  return { ...actual, authenticateAPI: vi.fn(), requireScopes: vi.fn() }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findFirst: vi.fn(), findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))

vi.mock('@/services/assignee-authorization', () => ({ authorizeAssigneeChange: vi.fn() }))

import { POST } from '@/app/api/v1/tasks/[id]/claim/route'
import { authenticateAPI, requireScopes } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { authorizeAssigneeChange } from '@/services/assignee-authorization'
import { AGENT_CLAIM_LEASE_DEFAULT_SECONDS } from '@/lib/agent-task-claim'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const params = Promise.resolve({ id: TASK_ID })
const NOW = new Date('2026-11-16T00:00:00.000Z')
const EDITED = new Date('2026-11-15T10:00:00.000Z')
const CODEX = `codex@${BRAND.agentEmailDomain}`
const CLAUDE = `claude@${BRAND.agentEmailDomain}`

const readyTask = {
  id: TASK_ID, statusRole: 'ready', completed: false, assigneeId: null, assigneeIds: [],
  updatedAt: EDITED, claimLeaseExpiresAt: null, claimHolderId: null,
}
const heldTask = {
  ...readyTask, statusRole: 'doing', assigneeId: 'codex-1', assigneeIds: ['codex-1'],
  claimLeaseExpiresAt: new Date('2026-11-16T00:05:00.000Z'), claimHolderId: 'codex-1',
}

function request(body: unknown) {
  return new NextRequest(`http://localhost/api/v1/tasks/${TASK_ID}/claim`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

const agentBound = {
  userId: 'owner-1', source: 'oauth', scopes: ['tasks:write'], isAIAgent: false,
  user: { id: 'owner-1', email: 'owner@example.test', name: 'Owner', isAIAgent: false },
  agentUser: { id: 'codex-1', email: CODEX, name: 'Codex', isAIAgent: true },
}
/** A client-credentials token: the owner's identity, no agent binding. */
const clientCredentials = {
  userId: 'owner-1', source: 'oauth', clientId: 'astrid_client_x', scopes: ['tasks:write'], isAIAgent: false,
  user: { id: 'owner-1', email: 'owner@example.test', name: 'Owner', isAIAgent: false },
  agentUser: null,
}

describe('POST /api/v1/tasks/:id/claim — leases (AWTD-1688)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    vi.mocked(authenticateAPI).mockResolvedValue(agentBound as never)
    vi.mocked(requireScopes).mockReturnValue(undefined)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(readyTask as never)
  })
  afterEach(() => vi.useRealTimers())

  it('a claim takes a 15-minute lease held by the claiming agent', async () => {
    const leaseEnd = new Date(NOW.getTime() + AGENT_CLAIM_LEASE_DEFAULT_SECONDS * 1000)
    vi.mocked(prisma.task.updateManyAndReturn).mockResolvedValue([{ ...heldTask, claimLeaseExpiresAt: leaseEnd }] as never)

    const response = await POST(request({ action: 'claim' }), { params })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      outcome: 'claimed', task: { statusRole: 'doing', claimLeaseExpiresAt: leaseEnd.toISOString() },
    })
    expect(AGENT_CLAIM_LEASE_DEFAULT_SECONDS).toBe(900)
    expect(vi.mocked(prisma.task.updateManyAndReturn).mock.calls[0][0]).toMatchObject({
      data: { statusRole: 'doing', claimLeaseExpiresAt: leaseEnd, claimHeartbeatAt: NOW, claimHolderId: 'codex-1' },
    })
  })

  it('honours leaseSeconds on a claim', async () => {
    vi.mocked(prisma.task.updateManyAndReturn).mockResolvedValue([heldTask] as never)

    await POST(request({ action: 'claim', leaseSeconds: 120 }), { params })

    expect(vi.mocked(prisma.task.updateManyAndReturn).mock.calls[0][0]).toMatchObject({
      data: { claimLeaseExpiresAt: new Date(NOW.getTime() + 120_000) },
    })
  })

  it.each([
    [{ action: 'claim', leaseSeconds: 30 }],
    [{ action: 'claim', leaseSeconds: 7200 }],
    [{ action: 'claim', leaseSeconds: 90.5 }],
    [{ action: 'release', leaseSeconds: 120 }],
  ])('refuses an invalid lease request %j with 400', async body => {
    const response = await POST(request(body), { params })
    expect(response.status).toBe(400)
    expect(prisma.task.updateManyAndReturn).not.toHaveBeenCalled()
  })

  it('heartbeat renews the holder\'s lease and leaves updatedAt as it was', async () => {
    vi.mocked(prisma.task.findFirst).mockResolvedValue(heldTask as never)
    const renewedEnd = new Date(NOW.getTime() + 900_000)
    vi.mocked(prisma.task.updateManyAndReturn).mockResolvedValue([{ ...heldTask, claimLeaseExpiresAt: renewedEnd }] as never)

    const response = await POST(request({ action: 'heartbeat' }), { params })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: 'renewed', task: { claimLeaseExpiresAt: renewedEnd.toISOString() } })
    expect(vi.mocked(prisma.task.updateManyAndReturn).mock.calls[0][0]).toMatchObject({
      where: { id: TASK_ID, completed: false, statusRole: 'doing', assigneeId: 'codex-1' },
      data: { claimLeaseExpiresAt: renewedEnd, claimHeartbeatAt: NOW, claimHolderId: 'codex-1', updatedAt: EDITED },
    })
  })

  it('heartbeat from an agent that does not hold the task is a conflict and writes nothing', async () => {
    vi.mocked(prisma.task.findFirst).mockResolvedValue({ ...heldTask, assigneeId: 'claude-1', claimHolderId: 'claude-1' } as never)

    const response = await POST(request({ action: 'heartbeat' }), { params })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ outcome: 'conflict' })
    expect(prisma.task.updateManyAndReturn).not.toHaveBeenCalled()
  })

  it('heartbeat on a task its expired lease already returned to Ready answers not_ready: stop work', async () => {
    vi.mocked(prisma.task.findFirst).mockResolvedValue({ ...readyTask, assigneeId: 'codex-1', assigneeIds: ['codex-1'] } as never)

    const response = await POST(request({ action: 'heartbeat' }), { params })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ outcome: 'not_ready' })
  })

  it('two agents racing for one task: exactly one wins', async () => {
    // The conditional UPDATE matches Ready; the first commit flips it to Doing.
    let taken = false
    vi.mocked(prisma.task.updateManyAndReturn).mockImplementation((async () => {
      if (taken) return []
      taken = true
      return [heldTask]
    }) as never)
    vi.mocked(prisma.task.findFirst)
      .mockResolvedValueOnce(readyTask as never)
      .mockResolvedValueOnce(readyTask as never)
      .mockResolvedValue(heldTask as never)
    vi.mocked(authenticateAPI)
      .mockResolvedValueOnce(agentBound as never)
      .mockResolvedValueOnce({ ...agentBound, agentUser: { id: 'claude-1', email: CLAUDE, name: 'Claude', isAIAgent: true } } as never)

    const [first, second] = await Promise.all([
      POST(request({ action: 'claim' }), { params }),
      POST(request({ action: 'claim' }), { params }),
    ])

    expect([first.status, second.status].sort()).toEqual([200, 409])
  })
})

describe('POST /api/v1/tasks/:id/claim — client credentials (AWTD-1688)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAPI).mockResolvedValue(clientCredentials as never)
    vi.mocked(requireScopes).mockReturnValue(undefined)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(readyTask as never)
    vi.mocked(prisma.task.findUnique).mockResolvedValue({ id: TASK_ID, creatorId: 'owner-1', lists: [{ id: 'list-1' }] } as never)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'claude-1', email: CLAUDE, isAIAgent: true, isActive: true } as never)
    vi.mocked(authorizeAssigneeChange).mockResolvedValue({ ok: true, assigneeExists: true })
    vi.mocked(prisma.task.updateManyAndReturn).mockResolvedValue([{ ...heldTask, assigneeId: 'claude-1', assigneeIds: ['claude-1'] }] as never)
  })

  it('claims for the agent it names, under the assign-an-agent rule', async () => {
    const response = await POST(request({ action: 'claim', agentMailbox: 'claude' }), { params })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: 'claimed', task: { assigneeId: 'claude-1' } })
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: CLAUDE } }))
    expect(authorizeAssigneeChange).toHaveBeenCalledWith({
      assigneeId: 'claude-1', actorId: 'owner-1', task: { id: TASK_ID, creatorId: 'owner-1' },
      targetListIds: ['list-1'], requireListMembership: false,
    })
    expect(vi.mocked(prisma.task.updateManyAndReturn).mock.calls[0][0]).toMatchObject({
      data: { assigneeId: 'claude-1', claimHolderId: 'claude-1' },
    })
  })

  it('refuses when the caller may not put that agent on the task', async () => {
    vi.mocked(authorizeAssigneeChange).mockResolvedValue({ ok: false, status: 403, error: 'no' })

    const response = await POST(request({ action: 'claim', agentMailbox: 'claude' }), { params })

    expect(response.status).toBe(403)
    expect(prisma.task.updateManyAndReturn).not.toHaveBeenCalled()
  })

  it.each([
    ['no mailbox', {}, undefined],
    ['an inactive agent', { agentMailbox: 'claude' }, { id: 'claude-1', email: CLAUDE, isAIAgent: true, isActive: false }],
    ['a person, not an agent', { agentMailbox: 'claude' }, { id: 'p-1', email: CLAUDE, isAIAgent: false, isActive: true }],
    ['no such account', { agentMailbox: 'nobody' }, null],
  ])('refuses %s', async (_label, extra, user) => {
    if (user !== undefined) vi.mocked(prisma.user.findUnique).mockResolvedValue(user as never)

    const response = await POST(request({ action: 'claim', ...extra }), { params })

    expect(response.status).toBe(403)
    expect(prisma.task.updateManyAndReturn).not.toHaveBeenCalled()
  })

  it('a browser session may not claim as an agent', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue({ ...clientCredentials, source: 'session', clientId: undefined } as never)

    const response = await POST(request({ action: 'claim', agentMailbox: 'claude' }), { params })

    expect(response.status).toBe(403)
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })
})
