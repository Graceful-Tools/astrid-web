/**
 * Task 359ca48f — `POST /api/v1/lists/:id/transfer-ownership`.
 *
 * The route existed only on the legacy, unversioned path. The iOS and Mac apps
 * call `/api/v1/...` exclusively (ASTRID.md rule 5), so a list owner on Mac saw
 * a line telling them to go use the web app — in a Membership tab that already
 * does everything else, for the one action an owner most needs, since an owner
 * cannot just leave a list.
 *
 * These tests cover the handler's own job: scope auth, reading the body, and
 * mapping the service's result onto the v1 envelope. The transfer rule itself
 * is tested in tests/lib/list-ownership-transfer.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const transferListOwnership = vi.hoisted(() => vi.fn())
vi.mock('@/lib/list-ownership-transfer', () => ({ transferListOwnership }))

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
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})

import { POST } from '@/app/api/v1/lists/[id]/transfer-ownership/route'
import { authenticateAPI, requireScopes } from '@/lib/api-auth-middleware'

const mockAuth = vi.mocked(authenticateAPI)
const mockRequireScopes = vi.mocked(requireScopes)

const auth = {
  userId: 'owner-1',
  source: 'oauth' as const,
  scopes: ['lists:read', 'lists:write', 'lists:manage_members'],
  isAIAgent: false,
  user: { id: 'owner-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

function makeReq(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/lists/list-1/transfer-ownership', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

const params = Promise.resolve({ id: 'list-1' })

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(auth as never)
  transferListOwnership.mockResolvedValue({ ok: true })
})

describe('POST /api/v1/lists/:id/transfer-ownership (task 359ca48f)', () => {
  it('passes the caller and the requested successor to the shared rule', async () => {
    const res = await POST(makeReq({ newOwnerId: 'new-owner-1' }), { params } as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(transferListOwnership).toHaveBeenCalledWith({
      listId: 'list-1',
      currentUserId: 'owner-1',
      newOwnerId: 'new-owner-1',
    })
    expect(body.message).toBe('Ownership transferred successfully')
  })

  it('carries the v1 meta envelope, like its siblings', async () => {
    const res = await POST(makeReq({ newOwnerId: 'new-owner-1' }), { params } as never)
    const body = await res.json()

    expect(body.meta).toEqual({ apiVersion: 'v1', authSource: 'oauth' })
  })

  it('requires the lists:manage_members scope', async () => {
    await POST(makeReq({ newOwnerId: 'new-owner-1' }), { params } as never)

    expect(mockRequireScopes).toHaveBeenCalledWith(expect.anything(), ['lists:manage_members'])
  })

  it('propagates the rule’s status and message rather than inventing its own', async () => {
    transferListOwnership.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Only the owner can transfer ownership',
    })

    const res = await POST(makeReq({ newOwnerId: 'new-owner-1' }), { params } as never)

    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Only the owner can transfer ownership')
  })

  it('400s a body with no newOwnerId', async () => {
    transferListOwnership.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'New owner ID is required',
    })

    const res = await POST(makeReq({}), { params } as never)

    expect(res.status).toBe(400)
    expect(transferListOwnership).toHaveBeenCalledWith(
      expect.objectContaining({ newOwnerId: '' })
    )
  })

  it('400s a malformed body instead of 500ing on the JSON parse', async () => {
    // An empty or non-JSON body is the caller's mistake to be told about, not
    // an unhandled exception surfacing as "something went wrong".
    transferListOwnership.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'New owner ID is required',
    })

    const res = await POST(makeReq(), { params } as never)

    expect(res.status).toBe(400)
  })

  it('ignores a non-string newOwnerId rather than passing it through', async () => {
    transferListOwnership.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'New owner ID is required',
    })

    await POST(makeReq({ newOwnerId: { id: 'new-owner-1' } }), { params } as never)

    expect(transferListOwnership).toHaveBeenCalledWith(
      expect.objectContaining({ newOwnerId: '' })
    )
  })
})
