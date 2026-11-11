import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { BRAND } from '@/lib/brand/config'

vi.mock('@/lib/api-auth-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth-middleware')>(
    '@/lib/api-auth-middleware',
  )
  return {
    ...actual,
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateManyAndReturn: vi.fn(),
    },
  },
}))

import { POST } from '@/app/api/v1/tasks/[id]/claim/route'
import { authenticateAPI, requireScopes } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const params = Promise.resolve({ id: TASK_ID })
const readyTask = {
  id: TASK_ID,
  statusRole: 'ready',
  completed: false,
  assigneeId: null,
  assigneeIds: [],
  updatedAt: new Date('2026-11-08T10:00:00.000Z'),
}

function request(body: unknown) {
  return new NextRequest(`http://localhost/api/v1/tasks/${TASK_ID}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/tasks/:id/claim (AWTD-1555)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('ASTRID_AGENT_CLAIM_API', 'on')
    vi.mocked(authenticateAPI).mockResolvedValue({
      userId: 'owner-1',
      source: 'oauth',
      scopes: ['tasks:write'],
      isAIAgent: false,
      user: { id: 'owner-1', email: 'owner@example.test', name: 'Owner', isAIAgent: false },
      agentUser: {
        id: 'codex-1',
        email: `codex@${BRAND.agentEmailDomain}`,
        name: 'Codex',
        isAIAgent: true,
      },
    } as never)
    vi.mocked(requireScopes).mockReturnValue(undefined)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(readyTask as never)
    vi.mocked(prisma.task.updateManyAndReturn).mockResolvedValue([{
      ...readyTask,
      statusRole: 'doing',
      assigneeId: 'codex-1',
      assigneeIds: ['codex-1'],
    }] as never)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('returns 404 before authentication unless the flag is exactly on', async () => {
    vi.stubEnv('ASTRID_AGENT_CLAIM_API', 'true')

    const response = await POST(request({ action: 'claim' }), { params })

    expect(response.status).toBe(404)
    expect(authenticateAPI).not.toHaveBeenCalled()
  })

  it('accepts a task identifier, as claim_task says it does (AWTD-1557 review)', async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValueOnce({ id: TASK_ID } as never)

    const response = await POST(request({ action: 'claim', agentMailbox: 'codex' }), {
      params: Promise.resolve({ id: 'AWTD-1555' }),
    })

    expect(prisma.task.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { identifier: 'AWTD-1555' } }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: 'claimed', task: { id: TASK_ID } })
  })

  it('atomically moves an accessible Ready task to Doing for the bound agent', async () => {
    const response = await POST(request({ action: 'claim', agentMailbox: 'codex' }), { params })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      outcome: 'claimed',
      task: { id: TASK_ID, statusRole: 'doing', assigneeId: 'codex-1' },
    })
    expect(prisma.task.updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: TASK_ID,
        completed: false,
        statusRole: 'ready',
        AND: expect.arrayContaining([
          expect.objectContaining({ OR: expect.any(Array) }),
          { OR: [{ assigneeId: null }, { assigneeId: 'codex-1' }] },
        ]),
      }),
      data: {
        assigneeId: 'codex-1',
        assigneeIds: ['codex-1'],
        statusRole: 'doing',
      },
    }))
  })

  it('returns already_yours when the same agent resumes its Doing task', async () => {
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      ...readyTask,
      statusRole: 'doing',
      assigneeId: 'codex-1',
      assigneeIds: ['codex-1'],
    } as never)

    const response = await POST(request({ action: 'resume' }), { params })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: 'already_yours' })
    expect(prisma.task.updateManyAndReturn).not.toHaveBeenCalled()
  })

  it('returns already_yours for a later same-agent claim after the first claim committed', async () => {
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      ...readyTask,
      statusRole: 'doing',
      assigneeId: 'codex-1',
      assigneeIds: ['codex-1'],
    } as never)

    const response = await POST(request({ action: 'claim' }), { params })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: 'already_yours' })
    expect(prisma.task.updateManyAndReturn).not.toHaveBeenCalled()
  })

  it('returns conflict to a concurrent same-agent claim loser', async () => {
    vi.mocked(prisma.task.findFirst)
      .mockResolvedValueOnce(readyTask as never)
      .mockResolvedValueOnce({
        ...readyTask,
        statusRole: 'doing',
        assigneeId: 'codex-1',
        assigneeIds: ['codex-1'],
      } as never)
    vi.mocked(prisma.task.updateManyAndReturn).mockResolvedValue([] as never)

    const response = await POST(request({ action: 'claim' }), { params })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      outcome: 'conflict',
      task: { statusRole: 'doing', assigneeId: 'codex-1' },
    })
  })

  it('releases only the current agent and promotes another assignee', async () => {
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      ...readyTask,
      statusRole: 'doing',
      assigneeId: 'codex-1',
      assigneeIds: ['codex-1', 'human-1'],
    } as never)
    vi.mocked(prisma.task.updateManyAndReturn).mockResolvedValue([{
      ...readyTask,
      assigneeId: 'human-1',
      assigneeIds: ['human-1'],
    }] as never)

    const response = await POST(request({ action: 'release' }), { params })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      outcome: 'released',
      task: { statusRole: 'ready', assigneeId: 'human-1', assigneeIds: ['human-1'] },
    })

    expect(prisma.task.updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        statusRole: 'doing',
        assigneeId: 'codex-1',
      }),
      data: {
        assigneeId: 'human-1',
        assigneeIds: ['human-1'],
        statusRole: 'ready',
      },
    }))
  })

  it('rejects an unbound mailbox and reports non-member, missing, and non-Ready outcomes', async () => {
    const wrongMailbox = await POST(request({ action: 'claim', agentMailbox: 'claude' }), { params })
    expect(wrongMailbox.status).toBe(403)
    expect(await wrongMailbox.json()).toEqual({ outcome: 'forbidden', task: null })
    expect(prisma.task.findFirst).not.toHaveBeenCalled()

    vi.mocked(prisma.task.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.task.findUnique).mockResolvedValue({ id: TASK_ID } as never)
    const nonMember = await POST(request({ action: 'claim' }), { params })
    expect(nonMember.status).toBe(403)
    expect(await nonMember.json()).toEqual({ outcome: 'forbidden', task: null })

    vi.mocked(prisma.task.findUnique).mockResolvedValue(null)
    const missing = await POST(request({ action: 'claim' }), { params })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ outcome: 'not_found', task: null })

    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      ...readyTask,
      statusRole: 'waiting',
    } as never)
    const notReady = await POST(request({ action: 'claim' }), { params })
    expect(notReady.status).toBe(409)
    expect(await notReady.json()).toMatchObject({ outcome: 'not_ready' })

    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      ...readyTask,
      completed: true,
    } as never)
    const completed = await POST(request({ action: 'claim' }), { params })
    expect(completed.status).toBe(409)
    expect(await completed.json()).toMatchObject({ outcome: 'not_ready' })
  })
})
