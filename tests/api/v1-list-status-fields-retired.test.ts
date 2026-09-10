/**
 * The four vestigial `TaskList.status*` fields are off the wire (AWTD-853).
 *
 * `statusRole`, `statusOrder`, `statusDescription` and `statusCompleted` on a
 * LIST described a board column back when a column was a `TaskList` with
 * `listType: 'status'`. AWTD-562 moved board status onto `Task.statusRole`, and
 * the Stage D migration `20260821000000_drop_status_lists` deleted every row
 * that ever carried them. The columns survived, and so did the wire contract:
 * three response projections still emitted them, four write sites still
 * accepted them, and a client could be storing values that nothing would ever
 * read back.
 *
 * **`Task.statusRole` is a different field and is untouched.** It is the live
 * board column. The two share a name, which is exactly why a grep-driven
 * removal is dangerous and why these tests name the list explicitly.
 *
 * The iOS side was audited first (astrid-ios AITD-376) rather than assumed: all
 * four are declared `decodeIfPresent` into optionals and have been since the
 * commit that introduced them, and every read has an explicit fallback. So no
 * shipped iOS or Mac build fails to decode a list without them, at any version,
 * and the deprecation window is zero.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const STATUS_FIELDS = ['statusRole', 'statusOrder', 'statusDescription', 'statusCompleted'] as const

/** What a client that predates this change still sends. */
const LEGACY_PAYLOAD = {
  statusRole: 'ready',
  statusOrder: 3,
  statusDescription: 'Things that are ready',
  statusCompleted: true,
} as const

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), count: vi.fn() },
    listMember: { deleteMany: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    task: { findMany: vi.fn(), updateMany: vi.fn(), groupBy: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/favorites', () => ({
  hydrateSingleListFavorite: vi.fn(),
  hydrateListFavorites: vi.fn(async (_u: string, lists: unknown[]) => lists),
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
    authenticateAPI: vi.fn(), requireScopes: vi.fn(),
    getDeprecationWarning: vi.fn(() => null),
    UnauthorizedError, ForbiddenError,
  }
})

import { GET as v1GetList, PUT as v1PutList } from '@/app/api/v1/lists/[id]/route'
import { PUT as legacyPutList } from '@/app/api/lists/[id]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { getServerSession } from 'next-auth'

const mockPrisma = vi.mocked(prisma, true)
const mockAuth = vi.mocked(authenticateAPI)

const OWNER = 'owner-1'
const LIST_ID = 'list-1'

/** A stored row that still carries the columns — the backfill has not run yet. */
const storedList = {
  id: LIST_ID,
  name: 'A list',
  ownerId: OWNER,
  privacy: 'PRIVATE',
  listType: 'regular',
  showSubtasks: true,
  listMembers: [{ userId: OWNER }],
  admins: [],
  members: [],
  owner: { id: OWNER },
  listInvites: [],
  _count: { tasks: 0 },
  ...LEGACY_PAYLOAD,
}

/** The `data` the route handed Prisma, whichever route wrote it. */
function updateData(): Record<string, unknown> {
  const call = mockPrisma.taskList.update.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> }
  return call.data
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({
    userId: OWNER, source: 'oauth', scopes: ['*'], isAIAgent: false,
    user: { id: OWNER, email: 'owner@example.com', name: 'Owner', isAIAgent: false },
  } as never)
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: OWNER, email: 'owner@example.com' } } as never)
  ;(mockPrisma.$transaction as unknown as { mockImplementation: (f: unknown) => void })
    .mockImplementation((op: (client: unknown) => unknown) => op(prisma))
  mockPrisma.taskList.findFirst.mockResolvedValue(storedList as never)
  mockPrisma.taskList.findUnique.mockResolvedValue(storedList as never)
  mockPrisma.taskList.update.mockResolvedValue(storedList as never)
  mockPrisma.listMember.findMany.mockResolvedValue([] as never)
  mockPrisma.user.findMany.mockResolvedValue([] as never)
})

describe('GET /api/v1/lists/:id no longer emits the list status fields (AWTD-853)', () => {
  it('omits all four, even when the stored row still has values', async () => {
    // The row deliberately carries values: the columns outlive this change by a
    // release, so "we stopped selecting them" is not what is being tested —
    // "we stopped putting them on the wire" is.
    const response = await v1GetList(
      new NextRequest(`http://localhost/api/v1/lists/${LIST_ID}`) as never,
      { params: Promise.resolve({ id: LIST_ID }) } as never,
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    for (const field of STATUS_FIELDS) {
      expect(Object.keys(body.list)).not.toContain(field)
    }
  })

  it('still carries the fields that describe a real list', async () => {
    // Guards the removal against over-reach: `listType` and `projectId` sit
    // beside the four and are alive.
    const response = await v1GetList(
      new NextRequest(`http://localhost/api/v1/lists/${LIST_ID}`) as never,
      { params: Promise.resolve({ id: LIST_ID }) } as never,
    )
    const body = await response.json()

    expect(body.list).toHaveProperty('listType')
    expect(body.list).toHaveProperty('projectId')
  })
})

describe('PUT /api/v1/lists/:id no longer accepts the list status fields (AWTD-853)', () => {
  it('ignores them rather than persisting them', async () => {
    // An older client round-tripping a whole list object is the case that
    // matters: it will keep sending these for as long as it is installed, and
    // a write that lands is a value nothing will ever read back.
    const response = await v1PutList(
      new NextRequest(`http://localhost/api/v1/lists/${LIST_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'A list', ...LEGACY_PAYLOAD }),
      }) as never,
      { params: Promise.resolve({ id: LIST_ID }) } as never,
    )

    expect(response.status).toBe(200)
    for (const field of STATUS_FIELDS) {
      expect(Object.keys(updateData())).not.toContain(field)
    }
  })

  it('does not answer with them either', async () => {
    const response = await v1PutList(
      new NextRequest(`http://localhost/api/v1/lists/${LIST_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'A list', ...LEGACY_PAYLOAD }),
      }) as never,
      { params: Promise.resolve({ id: LIST_ID }) } as never,
    )
    const body = await response.json()

    for (const field of STATUS_FIELDS) {
      expect(Object.keys(body.list)).not.toContain(field)
    }
  })

  it('still applies listType, which sits beside them and is alive', async () => {
    await v1PutList(
      new NextRequest(`http://localhost/api/v1/lists/${LIST_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'A list', listType: 'regular' }),
      }) as never,
      { params: Promise.resolve({ id: LIST_ID }) } as never,
    )

    expect(updateData().listType).toBe('regular')
  })
})

describe('PUT /api/lists/:id (legacy) no longer accepts them either (AWTD-853)', () => {
  it('ignores them rather than persisting them', async () => {
    // The legacy route is the one the web client itself PUTs whole list objects
    // to, so leaving it accepting them would keep writing the columns this
    // change exists to stop writing.
    const response = await legacyPutList(
      new NextRequest(`http://localhost/api/lists/${LIST_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'A list', ...LEGACY_PAYLOAD }),
      }) as never,
      { params: Promise.resolve({ id: LIST_ID }) } as never,
    )

    expect(response.status).toBe(200)
    for (const field of STATUS_FIELDS) {
      expect(Object.keys(updateData())).not.toContain(field)
    }
  })
})
