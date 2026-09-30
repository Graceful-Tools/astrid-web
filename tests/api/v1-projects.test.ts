/**
 * Route-level tests for /api/v1/projects (GET, POST) and
 * /api/v1/projects/:id (DELETE).
 *
 * The service layer in `lib/projects-service.ts` is mocked so these
 * focus on the v1 envelope, auth/scope wiring, and validation. Service
 * behaviour (transaction, seeding) is covered by its own unit tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/projects-service', () => ({
  listProjectsForUser: vi.fn(),
  createProjectForUser: vi.fn(),
  deleteProjectAndDetachLists: vi.fn(),
  authorizeBoardOwner: vi.fn(),
  collectProjectMemberUserIds: vi.fn(async () => []),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    // checkRequestedProjectKey also refuses a renamed-away key or a minted prefix (AWTD-1024).
    projectKeyAlias: { findUnique: vi.fn() },
    task: { findFirst: vi.fn() },
  },
}))

vi.mock('@/lib/task-identifier', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/task-identifier')>()),
  renameProjectKey: vi.fn(),
}))

// Project Mode is request-gated (task dd7172d8). Default: granted, so the
// pre-existing cases below still exercise the happy path. Gate logic itself is
// covered by tests/lib/project-mode.test.ts.
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
    requireScopes: vi.fn((auth: any, scopes: string[]) => {
      const granted: string[] = auth.scopes ?? []
      if (granted.includes('*')) return
      const missing = scopes.filter(s => !granted.includes(s))
      if (missing.length > 0) {
        throw new ForbiddenError(`Missing scopes: ${missing.join(', ')}`)
      }
    }),
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})

vi.mock('@/lib/redis', () => ({
  RedisCache: {
    invalidate: { userLists: vi.fn() },
    del: vi.fn(),
    keys: { userLists: (id: string) => `lists:user:${id}` },
  },
}))

import { GET as listProjects, POST as createProject } from '@/app/api/v1/projects/route'
import { DELETE as deleteProject, PATCH as patchProject } from '@/app/api/v1/projects/[id]/route'
import { renameProjectKey } from '@/lib/task-identifier'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import {
  listProjectsForUser,
  createProjectForUser,
  deleteProjectAndDetachLists,
  authorizeBoardOwner,
} from '@/lib/projects-service'
import { prisma } from '@/lib/prisma'
import { projectModeGate } from '@/lib/project-mode'

const mockGate = vi.mocked(projectModeGate)
const mockAuth = vi.mocked(authenticateAPI)
const mockList = vi.mocked(listProjectsForUser)
const mockCreate = vi.mocked(createProjectForUser)
const mockDelete = vi.mocked(deleteProjectAndDetachLists)
const mockPrisma = vi.mocked(prisma, true)
const mockRename = vi.mocked(renameProjectKey)
const mockOwner = vi.mocked(authorizeBoardOwner)

const ownerAuth = {
  userId: 'owner-1',
  source: 'oauth' as const,
  scopes: ['projects:read', 'projects:write', 'projects:delete'],
  isAIAgent: false,
  user: { id: 'owner-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

const readOnlyAuth = {
  ...ownerAuth,
  scopes: ['projects:read'],
}

function makeReq(method: 'GET' | 'POST' | 'DELETE' | 'PATCH', body?: unknown, path = 'http://localhost/api/v1/projects'): NextRequest {
  return new NextRequest(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('GET /api/v1/projects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ownerAuth as any)
    mockGate.mockResolvedValue(null)
  })

  it('returns the caller\'s projects under the v1 envelope', async () => {
    mockList.mockResolvedValue([
      { id: 'p1', name: 'P', lists: [] } as any,
    ])
    const res = await listProjects(makeReq('GET'), undefined as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.projects).toHaveLength(1)
    expect(json.projects[0].id).toBe('p1')
    expect(json.meta).toMatchObject({ apiVersion: 'v1', authSource: 'oauth' })
  })

  it('rejects callers without projects:read', async () => {
    mockAuth.mockResolvedValue({ ...ownerAuth, scopes: ['lists:read'] } as any)
    const res = await listProjects(makeReq('GET'), undefined as any)
    expect(res.status).toBe(403)
    expect(mockList).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/projects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ownerAuth as any)
    mockGate.mockResolvedValue(null)
  })

  it('refuses an ungranted OAuth caller — the gate is not a UI-only affordance (dd7172d8)', async () => {
    const { NextResponse } = await import('next/server')
    mockGate.mockResolvedValue(NextResponse.json({ reason: 'not_granted' }, { status: 403 }))

    const res = await createProject(
      new NextRequest('http://localhost/api/v1/projects', {
        method: 'POST',
        body: JSON.stringify({ name: 'Sneaky' }),
      }) as never,
      {} as never
    )

    expect(res.status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('400s when name is missing or blank', async () => {
    const res1 = await createProject(makeReq('POST', {}), undefined as any)
    expect(res1.status).toBe(400)
    const res2 = await createProject(makeReq('POST', { name: '   ' }), undefined as any)
    expect(res2.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('AWTD-1018: takes an owner-chosen key, canonical uppercase', async () => {
    mockCreate.mockResolvedValue({ id: 'p1', name: 'Web', lists: [] } as any)
    ;(mockPrisma.project.findUnique as any).mockResolvedValue(null)

    const res = await createProject(makeReq('POST', { name: 'Web', key: 'web' }), undefined as any)

    expect(res.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith('owner-1', expect.objectContaining({ key: 'WEB' }))
  })

  it('AWTD-1018: 400s a key the identifier format cannot carry', async () => {
    for (const key of ['A', 'ABCDEF', '2AB', 'A-B']) {
      const res = await createProject(makeReq('POST', { name: 'Web', key }), undefined as any)
      expect(res.status, key).toBe(400)
    }
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('AWTD-1018: 409s a key any other project already holds', async () => {
    ;(mockPrisma.project.findUnique as any).mockResolvedValue({ id: 'someone-elses' })

    const res = await createProject(makeReq('POST', { name: 'Web', key: 'AWTD' }), undefined as any)

    expect(res.status).toBe(409)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('creates a project + seeds defaults via the shared service', async () => {
    mockCreate.mockResolvedValue({
      id: 'p1',
      name: 'My Board',
      lists: [
        { id: 'l1', name: 'Ready', listType: 'status', statusRole: 'ready', statusOrder: 0 },
        { id: 'l2', name: 'Doing', listType: 'status', statusRole: 'doing', statusOrder: 1 },
        { id: 'l3', name: 'Waiting', listType: 'status', statusRole: 'waiting', statusOrder: 2 },
      ],
    } as any)

    const res = await createProject(
      makeReq('POST', { name: 'My Board', description: 'X', color: '#aabbcc' }),
      undefined as any,
    )

    expect(res.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith('owner-1', {
      name: 'My Board',
      description: 'X',
      color: '#aabbcc',
      imageUrl: undefined,
    })
    const json = await res.json()
    expect(json.project.id).toBe('p1')
    expect(json.project.lists).toHaveLength(3)
    expect(json.meta).toMatchObject({ apiVersion: 'v1' })
  })

  it('rejects callers without projects:write', async () => {
    mockAuth.mockResolvedValue(readOnlyAuth as any)
    const res = await createProject(makeReq('POST', { name: 'X' }), undefined as any)
    expect(res.status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/projects/:id', () => {
  const params = Promise.resolve({ id: 'p1' })

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ownerAuth as any)
  })

  it('returns 404 when the project does not exist', async () => {
    ;(mockPrisma.project.findUnique as any).mockResolvedValue(null)
    const res = await deleteProject(
      makeReq('DELETE', undefined, 'http://localhost/api/v1/projects/p1'),
      { params } as any,
    )
    expect(res.status).toBe(404)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('returns 403 when caller is not the owner', async () => {
    ;(mockPrisma.project.findUnique as any).mockResolvedValue({ ownerId: 'someone-else' })
    const res = await deleteProject(
      makeReq('DELETE', undefined, 'http://localhost/api/v1/projects/p1'),
      { params } as any,
    )
    expect(res.status).toBe(403)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('cascades + returns detached domain list ids when caller is owner', async () => {
    ;(mockPrisma.project.findUnique as any).mockResolvedValue({ ownerId: 'owner-1' })
    mockDelete.mockResolvedValue({
      project: { ownerId: 'owner-1' } as any,
      detachedListIds: ['domain-list-1'],
      userIdsToInvalidate: new Set<string>(['owner-1']),
    })

    const res = await deleteProject(
      makeReq('DELETE', undefined, 'http://localhost/api/v1/projects/p1'),
      { params } as any,
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({
      success: true,
      detachedListIds: ['domain-list-1'],
    })
    expect(mockDelete).toHaveBeenCalledWith('p1')
  })

  it('rejects callers without projects:delete', async () => {
    mockAuth.mockResolvedValue({ ...ownerAuth, scopes: ['projects:read'] } as any)
    const res = await deleteProject(
      makeReq('DELETE', undefined, 'http://localhost/api/v1/projects/p1'),
      { params } as any,
    )
    expect(res.status).toBe(403)
    expect(mockDelete).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/v1/projects/:id — rename the key (AWTD-1024)', () => {
  const params = Promise.resolve({ id: 'p1' })
  const patch = (body: unknown) =>
    patchProject(makeReq('PATCH', body, 'http://localhost/api/v1/projects/p1'), { params } as any)

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ownerAuth as any)
    mockOwner.mockResolvedValue({ ok: true })
  })

  it('renames for the owner and answers the new key and the one it replaced', async () => {
    mockRename.mockResolvedValue({ key: 'WEB', previousKey: 'AWTD' })

    const res = await patch({ key: 'web' })

    expect(res.status).toBe(200)
    expect(mockRename).toHaveBeenCalledWith('p1', 'web')
    expect(await res.json()).toMatchObject({ project: { id: 'p1', key: 'WEB' }, previousKey: 'AWTD' })
  })

  it('403s a member who does not own the board, and 404s an unknown one', async () => {
    mockOwner.mockResolvedValue({ error: 'forbidden' })
    expect((await patch({ key: 'WEB' })).status).toBe(403)
    mockOwner.mockResolvedValue({ error: 'not_found' })
    expect((await patch({ key: 'WEB' })).status).toBe(404)
    expect(mockRename).not.toHaveBeenCalled()
  })

  it('passes a taken or malformed key back with its status', async () => {
    mockRename.mockResolvedValue({ error: 'The key AITD is already taken', status: 409 })
    const res = await patch({ key: 'AITD' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'The key AITD is already taken' })
  })

  it('400s a body without a key', async () => {
    expect((await patch({ name: 'x' })).status).toBe(400)
    expect(mockRename).not.toHaveBeenCalled()
  })

  it('requires projects:write', async () => {
    mockAuth.mockResolvedValue(readOnlyAuth as any)
    expect((await patch({ key: 'WEB' })).status).toBe(403)
    expect(mockRename).not.toHaveBeenCalled()
  })
})
