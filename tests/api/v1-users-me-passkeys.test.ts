/**
 * /api/v1/users/me/passkeys (AWTD-885)
 *
 * Managing passkeys — list, rename, revoke — had only the unversioned
 * `/api/auth/webauthn/passkeys`, so a native client that speaks `/api/v1/...`
 * and holds an OAuth token could not reach the account's passkeys at all.
 *
 * **Registering** a passkey still belongs to the browser: the WebAuthn ceremony
 * needs a real user gesture against `rpID`, which is why the four
 * register/authenticate routes stay where they are and are exempt from the
 * legacy census. Listing, renaming and revoking are plain CRUD over rows the
 * account already owns, and there is nothing browser-shaped about them.
 *
 * Two shape decisions the legacy route got inconsistently, pinned here:
 *
 * - **One passkey is `/passkeys/:id`.** Legacy takes the id from the query
 *   string on DELETE and from the body on PATCH — two spellings of the same
 *   thing on one route. Here the id is the path, once.
 * - **A passkey belonging to someone else is a 404, not a 403.** `deletePasskey`
 *   and `renamePasskey` scope their lookup by `userId`, so "not yours" and "not
 *   there" are already indistinguishable to the caller — and should be: a 403
 *   would confirm that someone else's passkey id exists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/webauthn', () => ({
  getUserPasskeys: vi.fn(),
  deletePasskey: vi.fn(),
  renamePasskey: vi.fn(),
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

import { GET } from '@/app/api/v1/users/me/passkeys/route'
import { PATCH, DELETE } from '@/app/api/v1/users/me/passkeys/[id]/route'
import { getUserPasskeys, deletePasskey, renamePasskey } from '@/lib/webauthn'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockAuth = vi.mocked(authenticateAPI)
const mockList = vi.mocked(getUserPasskeys)
const mockDelete = vi.mocked(deletePasskey)
const mockRename = vi.mocked(renamePasskey)

const USER = 'user-1'
const PASSKEY = 'pk-1'

const PASSKEY_ROW = {
  id: PASSKEY,
  name: 'MacBook',
  credentialDeviceType: 'multiDevice',
  credentialBackedUp: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
}

const collection = () => new NextRequest('http://localhost/api/v1/users/me/passkeys')
const one = (method: string, body?: unknown) =>
  new NextRequest(`http://localhost/api/v1/users/me/passkeys/${PASSKEY}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  })
const ctx = { params: Promise.resolve({ id: PASSKEY }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ userId: USER, source: 'oauth', scopes: ['*'], clientId: 'c1' } as never)
  mockList.mockResolvedValue([PASSKEY_ROW] as never)
  mockDelete.mockResolvedValue({ success: true } as never)
  mockRename.mockResolvedValue({ success: true } as never)
})

describe('GET /api/v1/users/me/passkeys (AWTD-885)', () => {
  it('lists the caller’s passkeys in the v1 envelope', async () => {
    const response = await GET(collection() as never, undefined as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.passkeys).toHaveLength(1)
    expect(body.passkeys[0]).toMatchObject({ id: PASSKEY, name: 'MacBook' })
    expect(body.meta).toMatchObject({ apiVersion: 'v1', authSource: 'oauth' })
  })

  it('asks for the authenticated user’s passkeys, never a caller-supplied id', async () => {
    await GET(collection() as never, undefined as never)

    expect(mockList).toHaveBeenCalledWith(USER)
  })
})

describe('PATCH /api/v1/users/me/passkeys/:id (AWTD-885)', () => {
  it('renames the passkey named in the path', async () => {
    const response = await PATCH(one('PATCH', { name: 'Work laptop' }) as never, ctx as never)

    expect(response.status).toBe(200)
    expect(mockRename).toHaveBeenCalledWith(USER, PASSKEY, 'Work laptop')
  })

  it('is 400 when no name is given', async () => {
    const response = await PATCH(one('PATCH', {}) as never, ctx as never)

    expect(response.status).toBe(400)
    expect(mockRename).not.toHaveBeenCalled()
  })

  it('is 400 for a name that is only whitespace', async () => {
    const response = await PATCH(one('PATCH', { name: '   ' }) as never, ctx as never)

    expect(response.status).toBe(400)
    expect(mockRename).not.toHaveBeenCalled()
  })

  it('is 404 for a passkey that is not the caller’s', async () => {
    // renamePasskey scopes its lookup by userId, so someone else's passkey is
    // reported as absent. Answering 403 would confirm that the id exists.
    mockRename.mockResolvedValue({ success: false, error: 'Passkey not found' } as never)

    const response = await PATCH(one('PATCH', { name: 'Mine now' }) as never, ctx as never)

    expect(response.status).toBe(404)
  })
})

describe('DELETE /api/v1/users/me/passkeys/:id (AWTD-885)', () => {
  it('revokes the passkey named in the path', async () => {
    const response = await DELETE(one('DELETE') as never, ctx as never)

    expect(response.status).toBe(200)
    expect(mockDelete).toHaveBeenCalledWith(USER, PASSKEY)
  })

  it('is 404 for a passkey that is not the caller’s', async () => {
    mockDelete.mockResolvedValue({ success: false, error: 'Passkey not found' } as never)

    const response = await DELETE(one('DELETE') as never, ctx as never)

    expect(response.status).toBe(404)
  })
})
