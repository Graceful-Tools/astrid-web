import { beforeEach, describe, expect, it, vi } from 'vitest'
import { row } from '../fixtures/prisma-rows'
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
        user: {
          id: 'owner-1',
          email: 'owner@example.test',
          name: 'Owner',
          isAIAgent: false,
        },
      })
    ),
    requireScopes: vi.fn(),
  }
})

import { POST as v1Invite } from '@/app/api/v1/lists/[id]/invite/route'
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
    inviteToList.mockResolvedValue(row({
      ok: true,
      invitation: {
        id: 'invite-1',
        email: 'new@example.test',
        role: 'member',
        type: 'LIST_SHARING',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    }))
  })

  it.each([
    ['secure file GET', legacyFileGet, v1FileGet],
    ['secure file PUT', legacyFilePut, v1FilePut],
    ['secure file DELETE', legacyFileDelete, v1FileDelete],
  ])('%s is the same handler, not a drifting copy', (_name, legacy, v1) => {
    expect(v1).toBe(legacy)
  })

  // The legacy invite route was deleted (AWTD-839), so there is no second
  // response to compare against; what remains is v1's own contract.
  it('returns the service invitation inside the intentional v1 envelope', async () => {
    const request = () =>
      new NextRequest('http://localhost/api/v1/lists/list-1/invite', {
        method: 'POST',
        body: JSON.stringify({ email: 'new@example.test', role: 'member' }),
        headers: { 'content-type': 'application/json' },
      })
    const context = { params: Promise.resolve({ id: 'list-1' }) }

    const v1Response = await v1Invite(request(), context)
    const v1Body = await v1Response.json()

    expect(v1Response.status).toBe(200)
    expect(v1Body.invitation).toMatchObject({ id: 'invite-1', email: 'new@example.test', role: 'member' })
    expect(v1Body.meta).toEqual({ apiVersion: 'v1', authSource: 'session' })
  })
})
