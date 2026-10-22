/**
 * RED for AWTD-1319.
 *
 * GET /api/v1/lists caches each user's list set under `lists:user:<id>:v1` for
 * five minutes — the key iOS, Android and Windows sync from. PUT and DELETE on
 * /api/v1/lists/:id, the routes web writes through, cleared nothing on a
 * rename/recolour/delete (only the legacy key, and only on a project change),
 * so the change stayed invisible to the other clients until the TTL ran out.
 *
 * Both writes must clear every cached list set — legacy AND v1 — for everyone
 * who can see the list: owner, members, and the members of its project.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const userListsAllVersions = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    project: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
    listActivity: { create: vi.fn() },
    activityLog: { create: vi.fn() },
    deletionLog: { create: vi.fn() },
    externalListLink: { findMany: vi.fn(async () => []) },
    listViewPreference: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []), upsert: vi.fn() },
    task: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []), groupBy: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: unknown) => (typeof fn === 'function' ? (fn as (c: unknown) => unknown)(await import('@/lib/prisma').then(m => m.prisma)) : fn)),
  },
}))

vi.mock('@/lib/redis', () => ({
  RedisCache: {
    keys: { userLists: (id: string) => `lists:user:${id}`, userListsV1: (id: string) => `lists:user:${id}:v1` },
    del: vi.fn(async () => {}),
    getOrSet: vi.fn(async (_k: string, producer: () => Promise<unknown>) => producer()),
    invalidate: { userLists: vi.fn(), userListsAllVersions },
  },
}))

vi.mock('@/lib/images/update-list-image', () => ({
  ListImageClaimError: class extends Error {},
  updateListWithImageOwnership: vi.fn(async ({ update }: { update: (c: unknown) => unknown }) =>
    update((await import('@/lib/prisma')).prisma)),
  deleteListWithImageRelease: vi.fn(async (_id: string, del: (c: unknown) => unknown) =>
    del((await import('@/lib/prisma')).prisma)),
}))
vi.mock('@/lib/default-assignee', () => ({ resolveDefaultAssignees: vi.fn(async () => new Map()) }))
vi.mock('@/lib/backends/list-wire', () => ({ loadListBackendInfo: vi.fn(async () => new Map()) }))
vi.mock('@/lib/lists/v1-list-shape', () => ({ V1_LIST_READ_INCLUDE: {}, shapeV1List: (l: unknown) => l }))
vi.mock('@/lib/favorites', () => ({ hydrateSingleListFavorite: vi.fn(), toggleFavorite: vi.fn() }))
vi.mock('@/lib/analytics-events', () => ({ trackEventFromRequest: vi.fn(), AnalyticsEventType: {} }))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(), requireScopes: vi.fn(),
    UnauthorizedError, ForbiddenError, getDeprecationWarning: vi.fn(() => null),
  }
})

import { PUT, DELETE } from '@/app/api/v1/lists/[id]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma, true)

const listRow = {
  id: 'l1',
  ownerId: 'owner',
  name: 'Groceries',
  privacy: 'SHARED',
  projectId: 'p1',
  imageUrl: null,
  owner: { id: 'owner', name: 'O', email: 'o@e.com', image: null },
  listMembers: [{ userId: 'member', role: 'member' }],
  listInvites: [],
  defaultAssigneeId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

const ctx = { params: Promise.resolve({ id: 'l1' }) }
const invalidated = () => new Set(userListsAllVersions.mock.calls.map(c => (c as unknown[])[0]))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAPI).mockResolvedValue({ userId: 'owner', source: 'session', scopes: ['*'], clientId: null } as never)
  mockPrisma.taskList.findFirst.mockResolvedValue(listRow as never)
  mockPrisma.taskList.findUnique.mockResolvedValue(listRow as never)
  mockPrisma.taskList.update.mockResolvedValue(listRow as never)
  mockPrisma.taskList.delete.mockResolvedValue(listRow as never)
  mockPrisma.project.findMany.mockResolvedValue([{ ownerId: 'owner', members: [{ userId: 'project-member' }] }] as never)
})

describe('v1 list writes clear every cached list set (AWTD-1319)', () => {
  it('PUT (a rename) clears legacy + v1 for owner, members and project members', async () => {
    const res = await PUT(
      new NextRequest('http://localhost/api/v1/lists/l1', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Shopping' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx as never,
    )
    expect(res.status).toBe(200)
    expect(invalidated()).toEqual(new Set(['owner', 'member', 'project-member']))
  })

  it('DELETE clears legacy + v1 for everyone who could see the list', async () => {
    const res = await DELETE(new NextRequest('http://localhost/api/v1/lists/l1', { method: 'DELETE' }), ctx as never)
    expect(res.status).toBe(200)
    expect(invalidated()).toEqual(new Set(['owner', 'member', 'project-member']))
  })
})
