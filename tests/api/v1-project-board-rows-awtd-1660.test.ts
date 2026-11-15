/**
 * AWTD-1660 — GET/PUT /api/v1/projects/:id/board-rows: which lists a person's
 * project board shows as rows, saved on the server per person per project so
 * it follows them across devices.
 *
 * Authorisation is three existing rules, not new ones:
 *   - projectModeGate (lib/project-mode.ts): no project_mode, no board.
 *   - authorizeProjectAttach (lib/projects-service.ts): the project's owner or
 *     a member — the people the sidebar lists the project for.
 *   - listVisibilityWhere (lib/list-permissions.ts): a person can only add a
 *     list they can see.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { listVisibilityWhere } from '@/lib/list-permissions'

const prismaMock = vi.hoisted(() => ({
  projectBoardView: { findUnique: vi.fn(), upsert: vi.fn() },
  taskList: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

vi.mock('@/lib/projects-service', () => ({
  authorizeProjectAttach: vi.fn(),
}))

vi.mock('@/lib/project-mode', () => ({
  projectModeGate: vi.fn(),
  PROJECT_MODE_FEATURE_KEY: 'project_mode',
}))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  }
  class ForbiddenError extends Error {
    constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError' }
  }
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn((auth: { scopes?: string[] }, scopes: string[]) => {
      const granted: string[] = auth.scopes ?? []
      if (granted.includes('*')) return
      const missing = scopes.filter(s => !granted.includes(s))
      if (missing.length > 0) throw new ForbiddenError(`Missing scopes: ${missing.join(', ')}`)
    }),
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})

import { GET, PUT } from '@/app/api/v1/projects/[id]/board-rows/route'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { authorizeProjectAttach } from '@/lib/projects-service'
import { projectModeGate } from '@/lib/project-mode'

const mockAuth = vi.mocked(authenticateAPI)
const mockAttach = vi.mocked(authorizeProjectAttach)
const mockGate = vi.mocked(projectModeGate)

const auth = {
  userId: 'u1',
  source: 'session' as const,
  scopes: ['*'],
  isAIAgent: false,
  user: { id: 'u1', email: 'u1@example.com', name: 'U', isAIAgent: false },
}

const context = { params: Promise.resolve({ id: 'p1' }) }

function req(method: 'GET' | 'PUT', body?: unknown) {
  return new NextRequest('http://localhost/api/v1/projects/p1/board-rows', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(auth as never)
  mockGate.mockResolvedValue(null)
  mockAttach.mockResolvedValue({ ok: true })
})

describe('project_mode gating (AWTD-1660)', () => {
  it('GET answers with the gate\'s refusal for a user without project_mode', async () => {
    mockGate.mockResolvedValue(NextResponse.json({ reason: 'not_granted' }, { status: 403 }))
    const res = await GET(req('GET'), context as never)
    expect(res.status).toBe(403)
    expect(prismaMock.projectBoardView.findUnique).not.toHaveBeenCalled()
  })

  it('PUT answers with the gate\'s refusal and saves nothing', async () => {
    mockGate.mockResolvedValue(NextResponse.json({ error: 'Not found' }, { status: 404 }))
    const res = await PUT(req('PUT', { listIds: ['l1'] }), context as never)
    expect(res.status).toBe(404)
    expect(prismaMock.projectBoardView.upsert).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/projects/:id/board-rows (AWTD-1660)', () => {
  it('returns null listIds when nothing is saved, so the client shows the default rows', async () => {
    prismaMock.projectBoardView.findUnique.mockResolvedValue(null)
    const res = await GET(req('GET'), context as never)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ listIds: null })
  })

  it('returns the saved rows minus any list the person can no longer see', async () => {
    prismaMock.projectBoardView.findUnique.mockResolvedValue({ listIds: ['l1', 'gone', 'l2'] })
    prismaMock.taskList.findMany.mockResolvedValue([{ id: 'l2' }, { id: 'l1' }])
    const res = await GET(req('GET'), context as never)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ listIds: ['l1', 'l2'] })
  })

  it('reads the row for THIS person and THIS project', async () => {
    prismaMock.projectBoardView.findUnique.mockResolvedValue(null)
    await GET(req('GET'), context as never)
    expect(prismaMock.projectBoardView.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_projectId: { userId: 'u1', projectId: 'p1' } } }),
    )
  })

  it('404s a project that does not exist and 403s one the person is not on', async () => {
    mockAttach.mockResolvedValueOnce({ error: 'not_found' })
    expect((await GET(req('GET'), context as never)).status).toBe(404)
    mockAttach.mockResolvedValueOnce({ error: 'forbidden' })
    expect((await GET(req('GET'), context as never)).status).toBe(403)
  })
})

describe('PUT /api/v1/projects/:id/board-rows (AWTD-1660)', () => {
  it('saves the chosen rows, in order, per person per project', async () => {
    prismaMock.taskList.findMany.mockResolvedValue([{ id: 'l1' }, { id: 'l2' }])
    prismaMock.projectBoardView.upsert.mockResolvedValue({ listIds: ['l2', 'l1'] })
    const res = await PUT(req('PUT', { listIds: ['l2', 'l1'] }), context as never)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ listIds: ['l2', 'l1'] })
    expect(prismaMock.projectBoardView.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_projectId: { userId: 'u1', projectId: 'p1' } },
      create: { userId: 'u1', projectId: 'p1', listIds: ['l2', 'l1'] },
      update: { listIds: ['l2', 'l1'] },
    }))
  })

  it('checks list access with the shared visibility rule, not a hand-rolled one', async () => {
    prismaMock.taskList.findMany.mockResolvedValue([{ id: 'l1' }])
    prismaMock.projectBoardView.upsert.mockResolvedValue({ listIds: ['l1'] })
    await PUT(req('PUT', { listIds: ['l1'] }), context as never)
    const where = prismaMock.taskList.findMany.mock.calls[0][0].where
    expect(where.AND).toContainEqual(listVisibilityWhere('u1', { includePublic: false }))
  })

  it('refuses a list the person cannot read, and saves nothing', async () => {
    prismaMock.taskList.findMany.mockResolvedValue([{ id: 'l1' }])
    const res = await PUT(req('PUT', { listIds: ['l1', 'someone-elses'] }), context as never)
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ listIds: ['someone-elses'] })
    expect(prismaMock.projectBoardView.upsert).not.toHaveBeenCalled()
  })

  it('removing every row saves an empty board', async () => {
    prismaMock.projectBoardView.upsert.mockResolvedValue({ listIds: [] })
    const res = await PUT(req('PUT', { listIds: [] }), context as never)
    expect(res.status).toBe(200)
    expect(prismaMock.taskList.findMany).not.toHaveBeenCalled()
    await expect(res.json()).resolves.toMatchObject({ listIds: [] })
  })

  it('de-duplicates and rejects a malformed body', async () => {
    prismaMock.taskList.findMany.mockResolvedValue([{ id: 'l1' }])
    prismaMock.projectBoardView.upsert.mockResolvedValue({ listIds: ['l1'] })
    await PUT(req('PUT', { listIds: ['l1', 'l1'] }), context as never)
    expect(prismaMock.projectBoardView.upsert.mock.calls[0][0].update).toEqual({ listIds: ['l1'] })

    expect((await PUT(req('PUT', { listIds: 'l1' }), context as never)).status).toBe(400)
    expect((await PUT(req('PUT', { listIds: [42] }), context as never)).status).toBe(400)
    expect((await PUT(req('PUT', { listIds: Array.from({ length: 101 }, (_, i) => `l${i}`) }), context as never)).status).toBe(400)
  })

  it('a person not on the project cannot save rows for it', async () => {
    mockAttach.mockResolvedValue({ error: 'forbidden' })
    const res = await PUT(req('PUT', { listIds: [] }), context as never)
    expect(res.status).toBe(403)
    expect(prismaMock.projectBoardView.upsert).not.toHaveBeenCalled()
  })
})
