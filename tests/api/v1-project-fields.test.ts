/**
 * GET /api/v1/projects/:id/fields (AWTD-1208, spec §9.4.3).
 *
 * The field SCHEMA, served once per project so that task payloads can carry
 * nothing but `{ "<fieldId>": <scalar> }`. Without this route the names, types
 * and select options would have to ride every task, which is the payload
 * problem §9.4.3 exists to prevent.
 *
 * Pinned here, because each is the kind of mistake that still returns 200:
 *
 * - **Readable by anyone who can READ the board, not only its owner.** The
 *   schema is what makes a task's `fields` legible; a member who can load the
 *   tasks and not the schema sees a map of uuid to uuid. So the gate is list
 *   visibility, not `authorizeBoardOwner`.
 * - **A board the caller cannot see is 404, not 403** — otherwise the response
 *   tells them it exists.
 * - **The ETag changes when a field is deleted.** Built from the newest
 *   `updatedAt` AND the count, because a deletion moves no surviving row's
 *   timestamp and a timestamp-only tag would serve a 304 holding a field that
 *   is gone.
 * - **`updatedAt` is not on the wire.** It is tag material, not schema.
 *
 * The rules themselves live in `readProjectFieldSchema`
 * (services/github-project-fields.service.ts) — the route must not import Prisma
 * directly (tests/rules/prisma-in-routes-ratchet.test.ts). The service is real
 * here, only Prisma and the auth middleware are mocked, so these prove the route
 * reaches it rather than reimplementing the rules beside it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The capability is OFF by default in tests, and `withAuth` resolves it at
 * module load — so without this every assertion below would pass against a 404
 * and prove nothing. (It did, until a probe caught it.)
 */
const caps = vi.hoisted(() => ({ githubProjects: true }))
vi.mock('@/lib/brand/capabilities', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/brand/capabilities')>()
  return { ...actual, hasCapability: (key: string) => (key === 'githubProjects' ? caps.githubProjects : true) }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findFirst: vi.fn() },
    projectField: { findMany: vi.fn() },
  },
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
    UnauthorizedError, ForbiddenError, getDeprecationWarning: vi.fn(() => null),
  }
})

import { GET } from '@/app/api/v1/projects/[id]/fields/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma, true)
const mockAuth = vi.mocked(authenticateAPI)

const USER = 'user-1'
const BOARD = 'project-1'
const ctx = { params: Promise.resolve({ id: BOARD }) }

const req = (headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost/api/v1/projects/${BOARD}/fields`, { headers })

const field = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'field-1',
  remoteId: 'PVTSSF_abc',
  name: 'Status',
  dataType: 'single_select',
  options: [{ id: 'f75ad846', name: 'Todo' }],
  iterations: null,
  mappedTo: 'status',
  position: 0,
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ userId: USER } as never)
  mockPrisma.taskList.findFirst.mockResolvedValue({ id: 'list-1' } as never)
  mockPrisma.projectField.findMany.mockResolvedValue([field()] as never)
})

describe('GET /api/v1/projects/:id/fields (AWTD-1208)', () => {
  it('serves the schema to anyone who can read the board', async () => {
    const res = await GET(req(), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.fields).toEqual([
      {
        id: 'field-1',
        remoteId: 'PVTSSF_abc',
        name: 'Status',
        dataType: 'single_select',
        options: [{ id: 'f75ad846', name: 'Todo' }],
        iterations: null,
        mappedTo: 'status',
        position: 0,
      },
    ])
    // Tag material, not schema: a client has no use for it and it would change
    // the body on every write that changed nothing a client can see.
    expect(body.fields[0]).not.toHaveProperty('updatedAt')
  })

  it('asks for visibility, not ownership', async () => {
    const res = await GET(req(), ctx)

    // The guard read is against the board's LISTS with the visibility clause —
    // `authorizeBoardOwner` would have read `project.ownerId` instead and shut
    // out every member.
    const where = mockPrisma.taskList.findFirst.mock.calls[0]?.[0]?.where as Record<string, unknown>
    expect(where.projectId).toBe(BOARD)
    expect(where.OR).toBeDefined()
  })

  it('404s a board the caller cannot see, rather than 403', async () => {
    mockPrisma.taskList.findFirst.mockResolvedValue(null as never)

    const res = await GET(req(), ctx)
    expect(res.status).toBe(404)
    // And it never reads the fields of a board it would not show.
    expect(mockPrisma.projectField.findMany).not.toHaveBeenCalled()
  })

  it('304s an unchanged schema', async () => {
    const first = await GET(req(), ctx)
    const etag = first.headers.get('ETag')!

    const second = await GET(req({ 'if-none-match': etag }), ctx)
    expect(second.status).toBe(304)
    expect(second.headers.get('ETag')).toBe(etag)
  })

  it('changes the ETag when a field is DELETED, not only when one is edited', async () => {
    const two = [field(), field({ id: 'field-2', remoteId: 'PVTF_xyz', name: 'Estimate' })]
    mockPrisma.projectField.findMany.mockResolvedValue(two as never)
    const before = await GET(req(), ctx)
    const etagBefore = before.headers.get('ETag')

    // One removed. No surviving row's updatedAt moved, so a timestamp-only tag
    // would be identical here and a client would keep a field that is gone.
    mockPrisma.projectField.findMany.mockResolvedValue([two[0]] as never)
    const after = await GET(req(), ctx)

    expect(after.headers.get('ETag')).not.toBe(etagBefore)
  })

  it('orders the schema by position, so clients do not have to', async () => {
    const res = await GET(req(), ctx)

    expect(mockPrisma.projectField.findMany.mock.calls[0]?.[0]?.orderBy).toEqual({ position: 'asc' })
  })
})
