/**
 * Task e0613ae5 — v1 list reads must allow PUBLIC lists, as legacy does.
 *
 * This is the same bug as task 92e582c6, one endpoint over. That one was
 * `GET /api/v1/tasks/:id` refusing a task on a PUBLIC list; this is
 * `GET /api/v1/lists/:id` refusing the list itself.
 *
 *   legacy: hasListAccess(list, userId) || list.privacy === 'PUBLIC'
 *   v1:     where: { id, OR: [ownerId, listMembers.some] }   ← no PUBLIC branch
 *
 * The user-visible effect: `app/[locale]/lists/[listId]/page.tsx` and
 * `app/[locale]/list/[id]/page.tsx` both fetch `/api/v1/lists/:id`, and treat
 * 404 as "List not found". So a signed-in user opening a public list they do
 * not belong to is told the list does not exist — which is the entire audience
 * a public list is for.
 *
 * As with the task fix, this widens READS only. PUT and DELETE keep their
 * owner/admin gates: being able to see a public list must not imply being able
 * to rename or delete it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findFirst: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/favorites', () => ({
  hydrateSingleListFavorite: vi.fn(),
  toggleFavorite: vi.fn(),
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
    requireScopes: vi.fn(),
    getDeprecationWarning: vi.fn(() => null),
    UnauthorizedError,
    ForbiddenError,
  }
})

import { GET } from '@/app/api/v1/lists/[id]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const STRANGER = 'stranger-1'
const OWNER = 'owner-1'

type ListRow = {
  id: string
  ownerId: string
  privacy: string
  listMembers: { userId: string }[]
}

const PUBLIC_LIST: ListRow = {
  id: 'list-public', ownerId: OWNER, privacy: 'PUBLIC',
  listMembers: [{ userId: OWNER }],
}
const PRIVATE_LIST: ListRow = {
  id: 'list-private', ownerId: OWNER, privacy: 'PRIVATE',
  listMembers: [{ userId: OWNER }],
}

const ROWS = [PUBLIC_LIST, PRIVATE_LIST]

/**
 * Evaluate the route's `where` against fixture rows, so these tests describe
 * who gets in rather than how the query is spelled.
 */
function matches(row: ListRow, cond: Record<string, unknown>): boolean {
  return Object.entries(cond).every(([key, value]) => {
    if (key === 'id') return row.id === value
    if (key === 'OR') return (value as Record<string, unknown>[]).some(c => matches(row, c))
    if (key === 'ownerId') return row.ownerId === value
    if (key === 'privacy') return row.privacy === value
    if (key === 'listMembers') {
      const some = (value as { some: { userId: string } }).some
      return row.listMembers.some(m => m.userId === some.userId)
    }
    throw new Error(`unhandled condition: ${key}`)
  })
}

function req() {
  return new NextRequest('http://localhost/api/v1/lists/x')
}

async function getList(id: string, userId: string) {
  mockAuth.mockResolvedValue({
    userId, source: 'oauth', scopes: ['lists:read'], isAIAgent: false,
    user: { id: userId, email: `${userId}@example.com`, name: userId, isAIAgent: false },
  } as never)

  return GET(req() as never, { params: Promise.resolve({ id }) } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.taskList.findFirst.mockImplementation((async (args: {
    where: Record<string, unknown>
  }) => {
    const row = ROWS.find(r => matches(r, args.where))
    return row ? { ...row, owner: { id: row.ownerId }, listInvites: [], _count: { tasks: 0 } } : null
  }) as never)
})

describe('GET /api/v1/lists/:id — public-list reads (task e0613ae5)', () => {
  it('lets a signed-in non-member read a PUBLIC list', async () => {
    // The bug: this 404'd, and the list page renders 404 as "List not found" —
    // telling the public-list audience the list does not exist.
    const response = await getList('list-public', STRANGER)

    expect(response.status).toBe(200)
  })

  it('still refuses a non-member on a PRIVATE list', async () => {
    const response = await getList('list-private', STRANGER)

    expect(response.status).toBe(404)
  })

  it('still serves the owner their own private list', async () => {
    const response = await getList('list-private', OWNER)

    expect(response.status).toBe(200)
  })
})
