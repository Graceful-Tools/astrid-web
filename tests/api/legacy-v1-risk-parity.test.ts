import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { buildAuthContext } from '@/tests/fixtures/auth'

const inviteToList = vi.hoisted(() => vi.fn())
vi.mock('@/lib/list-invite', () => ({ inviteToList }))
vi.mock('@/lib/session-utils', () => ({
  getUnifiedSession: vi.fn(async () => ({
    user: { id: 'owner-1', email: 'owner@example.test', name: 'Owner' },
  })),
}))
vi.mock('@/lib/api-auth-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth-middleware')>(
    '@/lib/api-auth-middleware'
  )
  return {
    ...actual,
    authenticateAPI: vi.fn(async () =>
      buildAuthContext({
        userId: 'owner-1',
        user: { id: 'owner-1', email: 'owner@example.test', name: 'Owner' },
      })
    ),
    requireScopes: vi.fn(),
  }
})

import { POST as legacyInvite } from '@/app/api/lists/[id]/invite/route'
import { POST as v1Invite } from '@/app/api/v1/lists/[id]/invite/route'
import { POST as legacyUpload } from '@/app/api/secure-upload/request-upload/route'
import { POST as v1Upload } from '@/app/api/v1/secure-upload/request-upload/route'
import {
  GET as legacyFileGet,
  PUT as legacyFilePut,
  DELETE as legacyFileDelete,
} from '@/app/api/secure-files/[fileId]/route'
import {
  GET as v1FileGet,
  PUT as v1FilePut,
  DELETE as v1FileDelete,
} from '@/app/api/v1/secure-files/[fileId]/route'

describe('legacy/v1 critical adapter behavior table', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    inviteToList.mockResolvedValue({
      ok: true,
      invitation: {
        id: 'invite-1',
        email: 'new@example.test',
        role: 'member',
        type: 'LIST_SHARING',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    })
  })

  it.each([
    ['secure upload POST', legacyUpload, v1Upload],
    ['secure file GET', legacyFileGet, v1FileGet],
    ['secure file PUT', legacyFilePut, v1FilePut],
    ['secure file DELETE', legacyFileDelete, v1FileDelete],
  ])('%s is the same handler, not a drifting copy', (_name, legacy, v1) => {
    expect(v1).toBe(legacy)
  })

  it('keeps invite behavior equal while asserting the intentional v1 envelope', async () => {
    const request = () =>
      new NextRequest('http://localhost/api/lists/list-1/invite', {
        method: 'POST',
        body: JSON.stringify({ email: 'new@example.test', role: 'member' }),
        headers: { 'content-type': 'application/json' },
      })
    const context = { params: Promise.resolve({ id: 'list-1' }) }

    const [legacyResponse, v1Response] = await Promise.all([
      legacyInvite(request(), context),
      v1Invite(request(), context),
    ])
    const [legacyBody, v1Body] = await Promise.all([
      legacyResponse.json(),
      v1Response.json(),
    ])

    expect(v1Response.status).toBe(legacyResponse.status)
    expect(v1Body.invitation).toEqual(legacyBody.invitation)
    expect(legacyBody.meta).toBeUndefined()
    expect(v1Body.meta).toEqual({ apiVersion: 'v1', authSource: 'session' })
  })
})
