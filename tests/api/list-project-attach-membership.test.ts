/**
 * AWTD-1540 — a list's `projectId` was written straight from the request body.
 * Project membership cascades to every list in the project (status boards
 * included), so attaching a list to someone else's project and adding an
 * accomplice as a member exposed that project's boards. The caller must own or
 * belong to the project they attach to; detaching stays the list owner's call.
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

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(), requireScopes: vi.fn(),
    UnauthorizedError, ForbiddenError, getDeprecationWarning: vi.fn(() => null),
  }
})

import { PUT } from '@/app/api/v1/lists/[id]/route'
import { POST as legacyPOST } from '@/app/api/lists/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { getUnifiedSession } from '@/lib/session-utils'

const mockPrisma = vi.mocked(prisma, true)
const mockAuth = vi.mocked(authenticateAPI)
const mockSession = vi.mocked(getUnifiedSession)

const listRow = {
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
}

const ctx = { params: Promise.resolve({ id: 'l1' }) }

function put(body: Record<string, unknown>) {
  return PUT(
    new NextRequest('http://localhost/api/v1/lists/l1', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    ctx as never
  )
}

function post(body: Record<string, unknown>) {
  return legacyPOST(
    new NextRequest('http://localhost/api/lists', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ userId: 'u1', source: 'session', scopes: ['*'], clientId: null } as never)
  mockSession.mockResolvedValue({ user: { id: 'u1', email: 'j@e.com', name: null, image: null } } as never)
  mockPrisma.taskList.findFirst.mockResolvedValue(listRow as never)
  mockPrisma.taskList.findUnique.mockResolvedValue(listRow as never)
  mockPrisma.taskList.findMany.mockResolvedValue([] as never)
  ;(mockPrisma.$transaction as any).mockImplementation((operation: any) => operation(mockPrisma))
  mockPrisma.user.findMany.mockResolvedValue([] as never)
  mockPrisma.taskList.update.mockResolvedValue(listRow as never)
  mockPrisma.taskList.create.mockResolvedValue(listRow as never)
})

const strangersProject = { ownerId: 'someone-else', members: [] }

describe('PUT /api/v1/lists/:id projectId (AWTD-1540)', () => {
  it('403s when the caller is not on the project, and writes nothing', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(strangersProject as never)
    const res = await put({ projectId: 'p-other' })
    expect(res.status).toBe(403)
    expect(mockPrisma.taskList.update).not.toHaveBeenCalled()
  })

  it('404s for a project that does not exist', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null)
    expect((await put({ projectId: 'nope' })).status).toBe(404)
    expect(mockPrisma.taskList.update).not.toHaveBeenCalled()
  })

  it('lets the project owner attach (iOS Create Board)', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ ownerId: 'u1', members: [] } as never)
    // Only the write is asserted: the response is built by code these mocks do
    // not stand up, as in v1-lists-id-put-color.test.ts.
    await put({ projectId: 'p-mine' })
    expect(mockPrisma.taskList.update.mock.calls[0]?.[0]).toMatchObject({ data: { projectId: 'p-mine' } })
  })

  it('lets a project member attach', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ ownerId: 'x', members: [{ userId: 'u1' }] } as never)
    await put({ projectId: 'p-shared' })
    expect(mockPrisma.taskList.update.mock.calls[0]?.[0]).toMatchObject({ data: { projectId: 'p-shared' } })
  })

  it('still lets the list owner detach with null, without a project lookup', async () => {
    await put({ projectId: null })
    expect(mockPrisma.taskList.update.mock.calls[0]?.[0]).toMatchObject({ data: { projectId: null } })
    expect(mockPrisma.project.findUnique).not.toHaveBeenCalled()
  })
})

describe('POST /api/lists projectId (AWTD-1540)', () => {
  it('403s when the caller is not on the project, and creates nothing', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(strangersProject as never)
    const res = await post({ name: 'Sneaky', projectId: 'p-other' })
    expect(res.status).toBe(403)
    expect(mockPrisma.taskList.create).not.toHaveBeenCalled()
  })

  it('creates the list for a project the caller owns', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ ownerId: 'u1', members: [] } as never)
    const res = await post({ name: 'Mine', projectId: 'p-mine' })
    expect(res.status).not.toBe(403)
    expect(mockPrisma.taskList.create.mock.calls[0]?.[0]).toMatchObject({ data: { projectId: 'p-mine' } })
  })
})
