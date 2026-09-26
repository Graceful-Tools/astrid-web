/**
 * AWTD-1016 — PUT and DELETE `/api/v1/tasks/:id` accept a human-readable
 * identifier (AWTD-1007), not only a UUID. GET already did (task 12f54df4);
 * a script that could read `AWTD-1007` but not complete it was a trap.
 *
 * Access is still checked against the RESOLVED uuid, and an identifier that
 * matches nothing answers 404 before any access check — the same answer a
 * hidden task gets, so the route is no existence oracle.
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
    requireTaskReadAccess: vi.fn(),
    getDeprecationWarning: vi.fn(() => null),
    UnauthorizedError,
    ForbiddenError,
  }
})

vi.mock('@/lib/task-identifier', () => ({
  resolveTaskIdOrIdentifier: vi.fn(async (value: string) => {
    if (value === 'AWTD-7') return 'task-uuid-7'
    if (value === 'AWTD-404') return null
    return value
  }),
}))
vi.mock('@/services/task.service', () => ({
  updateTaskWithSideEffects: vi.fn(async () => ({
    ok: true,
    task: { id: 'task-uuid-7', lists: [], comments: [] },
  })),
  deleteTaskWithSideEffects: vi.fn(async () => undefined),
}))
vi.mock('@/lib/ai-agent-author', () => ({
  resolveAgentAuthor: vi.fn(async () => ({ ok: true, authorId: 'user-1' })),
}))
vi.mock('@/lib/analytics-events', () => ({
  trackEventFromRequest: vi.fn(),
  detectPlatform: vi.fn(() => 'web'),
  AnalyticsEventType: {},
}))
vi.mock('@/lib/sync/mirror-deletes', () => ({ mirrorExternalDeletesForTask: vi.fn() }))

import { PUT, DELETE } from '@/app/api/v1/tasks/[id]/route'
import { authenticateAPI, requireScopes, requireTaskAccess } from '@/lib/api-auth-middleware'
import { updateTaskWithSideEffects, deleteTaskWithSideEffects } from '@/services/task.service'

const auth = {
  userId: 'user-1',
  source: 'oauth' as const,
  scopes: ['tasks:write', 'tasks:delete'],
  isAIAgent: false,
  user: { id: 'user-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

function req(method: 'PUT' | 'DELETE', id: string, body?: unknown) {
  return new NextRequest(`http://localhost/api/v1/tasks/${id}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never

describe('identifiers on v1 task writes (AWTD-1016)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAPI).mockResolvedValue(auth as never)
    vi.mocked(requireScopes).mockReturnValue(undefined as never)
    vi.mocked(requireTaskAccess).mockResolvedValue(undefined as never)
  })

  it('PUT resolves AWTD-7 to its uuid before the access check and the update (AWTD-1016)', async () => {
    const res = await PUT(req('PUT', 'AWTD-7', { title: 'Renamed' }) as never, ctx('AWTD-7'))

    expect(res.status).toBe(200)
    expect(requireTaskAccess).toHaveBeenCalledWith('user-1', 'task-uuid-7')
    expect(vi.mocked(updateTaskWithSideEffects).mock.calls[0][0]).toMatchObject({ taskId: 'task-uuid-7' })
  })

  it('DELETE resolves AWTD-7 to its uuid before the access check and the delete (AWTD-1016)', async () => {
    const res = await DELETE(req('DELETE', 'AWTD-7') as never, ctx('AWTD-7'))

    expect(res.status).toBe(200)
    expect(requireTaskAccess).toHaveBeenCalledWith('user-1', 'task-uuid-7')
    expect(vi.mocked(deleteTaskWithSideEffects).mock.calls[0][0]).toMatchObject({ taskId: 'task-uuid-7' })
  })

  it('an identifier that matches nothing is 404 on PUT and DELETE, with no write attempted (AWTD-1016)', async () => {
    const put = await PUT(req('PUT', 'AWTD-404', { title: 'x' }) as never, ctx('AWTD-404'))
    const del = await DELETE(req('DELETE', 'AWTD-404') as never, ctx('AWTD-404'))

    expect(put.status).toBe(404)
    expect(del.status).toBe(404)
    expect(requireTaskAccess).not.toHaveBeenCalled()
    expect(updateTaskWithSideEffects).not.toHaveBeenCalled()
    expect(deleteTaskWithSideEffects).not.toHaveBeenCalled()
  })

  it('a uuid still passes straight through (AWTD-1016)', async () => {
    await PUT(req('PUT', 'task-uuid-7', { title: 'x' }) as never, ctx('task-uuid-7'))
    expect(requireTaskAccess).toHaveBeenCalledWith('user-1', 'task-uuid-7')
  })
})
