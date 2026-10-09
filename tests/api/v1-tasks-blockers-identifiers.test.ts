/**
 * AWTD-1086 — the blocker routes accept a human-readable identifier
 * (AWTD-1007) wherever they take a task id, for BOTH tasks in the link.
 *
 * Every other v1 task route has resolved identifiers since AWTD-1016; the
 * blocker routes (AWTD-1002) were written against UUIDs only, so
 * `POST /tasks/AWTD-7/blockers` was a 404 and `{ blockingTaskId: "AWTD-9" }`
 * reached Prisma as a literal string. An agent that knows a task by the name
 * on the board could read "waiting on" but not set it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  }
  class ForbiddenError extends Error {
    constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError' }
  }
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    requireTaskAccess: vi.fn(),
    getDeprecationWarning: vi.fn(() => null),
    UnauthorizedError,
    ForbiddenError,
  }
})

vi.mock('@/lib/task-identifier', () => ({
  resolveTaskIdOrIdentifier: vi.fn(async (value: string) => {
    if (value === 'AWTD-7') return 'task-uuid-7'
    if (value === 'AWTD-9') return 'task-uuid-9'
    if (value === 'AWTD-404') return null
    return value
  }),
}))
vi.mock('@/lib/project-mode', () => ({ projectModeGate: vi.fn(async () => null) }))
vi.mock('@/services/task-dependency.service', () => ({
  addBlocker: vi.fn(async () => ({ ok: true, created: true, blockedBy: [] })),
  removeBlocker: vi.fn(async () => ({ ok: true, removed: true, blockedBy: [] })),
  getBlockersForTask: vi.fn(async () => ({ blockedBy: [], blocks: [] })),
}))

import { POST, GET } from '@/app/api/v1/tasks/[id]/blockers/route'
import { DELETE } from '@/app/api/v1/tasks/[id]/blockers/[blockingTaskId]/route'
import { authenticateAPI, requireTaskAccess } from '@/lib/api-auth-middleware'
import { addBlocker, removeBlocker, getBlockersForTask } from '@/services/task-dependency.service'

const auth = {
  userId: 'user-1',
  source: 'oauth' as const,
  scopes: ['tasks:read', 'tasks:write'],
  isAIAgent: false,
  user: { id: 'user-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

function req(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
  return new NextRequest(`http://localhost/api/v1/tasks/${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as never

describe('identifiers on the blocker routes (AWTD-1086)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAPI).mockResolvedValue(auth as never)
  })

  it('POST resolves the blocked task and the blocking task', async () => {
    const res = await POST(
      req('POST', 'AWTD-7/blockers', { blockingTaskId: 'AWTD-9' }),
      ctx({ id: 'AWTD-7' }),
    )

    expect(res.status).toBe(201)
    expect(requireTaskAccess).toHaveBeenCalledWith('user-1', 'task-uuid-7')
    expect(addBlocker).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-uuid-7', blockingTaskId: 'task-uuid-9' }),
    )
    const body = await res.json()
    expect(body.taskId).toBe('task-uuid-7')
    expect(body.blockingTaskId).toBe('task-uuid-9')
  })

  it('POST answers 404 for an identifier that matches nothing, before any access check', async () => {
    const res = await POST(
      req('POST', 'AWTD-404/blockers', { blockingTaskId: 'AWTD-9' }),
      ctx({ id: 'AWTD-404' }),
    )
    expect(res.status).toBe(404)
    expect(requireTaskAccess).not.toHaveBeenCalled()
    expect(addBlocker).not.toHaveBeenCalled()
  })

  it('POST answers 404 when the blocking identifier matches nothing', async () => {
    const res = await POST(
      req('POST', 'AWTD-7/blockers', { blockingTaskId: 'AWTD-404' }),
      ctx({ id: 'AWTD-7' }),
    )
    expect(res.status).toBe(404)
    expect(addBlocker).not.toHaveBeenCalled()
  })

  it('GET resolves the task identifier', async () => {
    const res = await GET(req('GET', 'AWTD-7/blockers'), ctx({ id: 'AWTD-7' }))
    expect(res.status).toBe(200)
    expect(getBlockersForTask).toHaveBeenCalledWith('task-uuid-7', 'user-1')
  })

  it('DELETE resolves both identifiers', async () => {
    const res = await DELETE(
      req('DELETE', 'AWTD-7/blockers/AWTD-9'),
      ctx({ id: 'AWTD-7', blockingTaskId: 'AWTD-9' }),
    )
    expect(res.status).toBe(200)
    expect(requireTaskAccess).toHaveBeenCalledWith('user-1', 'task-uuid-7')
    expect(removeBlocker).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-uuid-7', blockingTaskId: 'task-uuid-9' }),
    )
  })

  it('UUIDs pass through unchanged', async () => {
    await POST(
      req('POST', 'task-uuid-7/blockers', { blockingTaskId: 'task-uuid-9' }),
      ctx({ id: 'task-uuid-7' }),
    )
    expect(addBlocker).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-uuid-7', blockingTaskId: 'task-uuid-9' }),
    )
  })
})
