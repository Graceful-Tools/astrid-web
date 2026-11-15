/**
 * AWTD-1702 — moving a list into/out of a project, and creating one inside it.
 *
 * Project membership cascades to every list in the project, so attaching or
 * detaching is the project's owner/admin's call AS WELL AS the list's. Creating a
 * new list in a project only needs membership: the caller owns what they create.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    project: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    listActivity: { create: vi.fn() },
    activityLog: { create: vi.fn() },
    task: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []), groupBy: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: unknown) =>
      typeof fn === 'function' ? (fn as (tx: unknown) => unknown)({}) : fn
    ),
  },
}))

vi.mock('@/lib/redis', () => ({
  RedisCache: {
    get: vi.fn(), set: vi.fn(), del: vi.fn(),
    delPattern: vi.fn(async () => undefined),
    keys: { userListsV1: (id: string) => `lists:v1:${id}`, userLists: (id: string) => `lists:${id}` },
    getOrSet: vi.fn(async (_k: string, producer: () => Promise<unknown>) => producer()),
    invalidate: { userLists: vi.fn(), userListsAllVersions: vi.fn() },
  },
}))

vi.mock('@/lib/session-utils', () => ({ getUnifiedSession: vi.fn() }))

vi.mock('@/lib/project-mode', () => ({ projectModeGate: vi.fn(async () => null) }))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(), requireScopes: vi.fn(),
    UnauthorizedError, ForbiddenError, getDeprecationWarning: vi.fn(() => null),
  }
})

import { PUT } from '@/app/api/v1/lists/[id]/route'
import { POST } from '@/app/api/v1/lists/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { projectModeGate } from '@/lib/project-mode'

const mockPrisma = vi.mocked(prisma, true)
const mockAuth = vi.mocked(authenticateAPI)

const listRow = (over: Record<string, unknown> = {}) => ({
  id: 'l1',
  ownerId: 'u1',
  name: 'Mine',
  privacy: 'PRIVATE',
  projectId: null,
  owner: { id: 'u1', name: 'Jon', email: 'j@e.com', image: null },
  listMembers: [],
  listInvites: [],
  defaultAssigneeId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
})

type ProjectRole = 'owner' | 'admin' | 'member'
/** The project as the caller `u1` sees it, by their role in it. */
const projectAs = (role: ProjectRole | 'none') => ({
  ownerId: role === 'owner' ? 'u1' : 'someone-else',
  members: role === 'admin' || role === 'member' ? [{ userId: 'u1', role }] : [],
})

const ctx = { params: Promise.resolve({ id: 'l1' }) }
const put = (body: Record<string, unknown>) =>
  PUT(
    new NextRequest('http://localhost/api/v1/lists/l1', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    ctx as never
  )
const post = (body: Record<string, unknown>) =>
  POST(
    new NextRequest('http://localhost/api/v1/lists', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    {} as never
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ userId: 'u1', source: 'session', scopes: ['*'], clientId: null } as never)
  mockPrisma.taskList.findFirst.mockResolvedValue(listRow() as never)
  mockPrisma.taskList.findUnique.mockResolvedValue(listRow() as never)
  mockPrisma.taskList.findMany.mockResolvedValue([] as never)
  ;(mockPrisma.$transaction as any).mockImplementation((operation: any) => operation(mockPrisma))
  mockPrisma.user.findMany.mockResolvedValue([] as never)
  mockPrisma.taskList.update.mockResolvedValue(listRow() as never)
  mockPrisma.taskList.create.mockResolvedValue(listRow() as never)
  vi.mocked(projectModeGate).mockResolvedValue(null)
})

describe('POST /api/v1/lists projectId (AWTD-1702)', () => {
  it.each(['owner', 'admin', 'member'] as const)('creates the list in the project for a project %s', async role => {
    mockPrisma.project.findUnique.mockResolvedValue(projectAs(role) as never)
    await post({ name: 'New', projectId: 'p1' })
    expect(mockPrisma.taskList.create.mock.calls[0]?.[0]).toMatchObject({ data: { projectId: 'p1', ownerId: 'u1' } })
  })

  it('403s PROJECT_CREATE_FORBIDDEN for a non-member and creates nothing', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(projectAs('none') as never)
    const res = await post({ name: 'New', projectId: 'p1' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('PROJECT_CREATE_FORBIDDEN')
    expect(mockPrisma.taskList.create).not.toHaveBeenCalled()
  })

  it('404s for an unknown project and creates nothing', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null)
    expect((await post({ name: 'New', projectId: 'nope' })).status).toBe(404)
    expect(mockPrisma.taskList.create).not.toHaveBeenCalled()
  })

  it('applies the Project Mode gate when a projectId is sent', async () => {
    const { NextResponse } = await import('next/server')
    vi.mocked(projectModeGate).mockResolvedValue(NextResponse.json({ reason: 'not_granted' }, { status: 403 }))
    const res = await post({ name: 'New', projectId: 'p1' })
    expect(res.status).toBe(403)
    expect(mockPrisma.taskList.create).not.toHaveBeenCalled()
  })

  it('does not gate or look up a project when no projectId is sent', async () => {
    await post({ name: 'Plain' })
    expect(projectModeGate).not.toHaveBeenCalled()
    expect(mockPrisma.project.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.taskList.create).toHaveBeenCalled()
  })
})

describe('PUT /api/v1/lists/:id projectId — attach (AWTD-1702)', () => {
  it.each([
    ['owner', 200],
    ['admin', 200],
    ['member', 403],
    ['none', 403],
  ] as const)('destination project %s → %s', async (role, status) => {
    mockPrisma.project.findUnique.mockResolvedValue(projectAs(role) as never)
    const res = await put({ projectId: 'p-dest' })
    if (status === 403) {
      expect(res.status).toBe(403)
      expect((await res.json()).code).toBe('PROJECT_ATTACH_FORBIDDEN')
      expect(mockPrisma.taskList.update).not.toHaveBeenCalled()
    } else {
      expect(mockPrisma.taskList.update.mock.calls[0]?.[0]).toMatchObject({ data: { projectId: 'p-dest' } })
    }
  })

  it('404s for a project that does not exist', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null)
    expect((await put({ projectId: 'nope' })).status).toBe(404)
    expect(mockPrisma.taskList.update).not.toHaveBeenCalled()
  })

  it('a plain list member cannot attach, even as project admin', async () => {
    mockPrisma.taskList.findFirst.mockResolvedValue(null)
    mockPrisma.project.findUnique.mockResolvedValue(projectAs('admin') as never)
    expect((await put({ projectId: 'p-dest' })).status).toBe(404)
    expect(mockPrisma.taskList.update).not.toHaveBeenCalled()
  })
})

describe('PUT /api/v1/lists/:id projectId — detach and move (AWTD-1702)', () => {
  const inProject = () => listRow({ projectId: 'p-src' })

  it.each([
    ['owner', true],
    ['admin', true],
    ['member', false],
    ['none', false],
  ] as const)('leaving a project where the caller is %s → allowed: %s', async (role, allowed) => {
    mockPrisma.taskList.findFirst.mockResolvedValue(inProject() as never)
    mockPrisma.project.findUnique.mockResolvedValue(projectAs(role) as never)
    const res = await put({ projectId: null })
    if (allowed) {
      expect(mockPrisma.taskList.update.mock.calls[0]?.[0]).toMatchObject({ data: { projectId: null } })
    } else {
      expect(res.status).toBe(403)
      expect((await res.json()).code).toBe('PROJECT_DETACH_FORBIDDEN')
      expect(mockPrisma.taskList.update).not.toHaveBeenCalled()
    }
  })

  it('detaching a list that is in no project is a no-op, with no lookup', async () => {
    await put({ projectId: null })
    expect(mockPrisma.project.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.taskList.update.mock.calls[0]?.[0]).toMatchObject({ data: { projectId: null } })
  })

  it('moving between projects needs admin on both', async () => {
    mockPrisma.taskList.findFirst.mockResolvedValue(inProject() as never)
    mockPrisma.project.findUnique.mockImplementation((async (args: { where: { id: string } }) =>
      args.where.id === 'p-src' ? projectAs('member') : projectAs('owner')) as never)
    const res = await put({ projectId: 'p-dest' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('PROJECT_DETACH_FORBIDDEN')
    expect(mockPrisma.taskList.update).not.toHaveBeenCalled()
  })

  it('re-sending the current projectId changes nothing and needs no project role', async () => {
    mockPrisma.taskList.findFirst.mockResolvedValue(inProject() as never)
    mockPrisma.project.findUnique.mockResolvedValue(projectAs('member') as never)
    const res = await put({ projectId: 'p-src' })
    expect(res.status).not.toBe(403)
    expect(mockPrisma.taskList.update).toHaveBeenCalled()
  })
})
