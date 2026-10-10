/**
 * AWTD-1114 (P3d): GET /api/v1/github/installations backs the one GitHub card
 * on Settings → Connections. It lists every installation the user can act on,
 * from the installation model (AWTD-1111) — not the first GitHubIntegration
 * row, and never an installation the user has no access row for.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockPrisma } from '../setup'
import { unknownWhereFields } from '../utils/prisma-where'
import { authenticateAPI, requireScopes } from '@/lib/api-auth-middleware'

vi.mock('@/lib/api-auth-middleware', () => ({
  authenticateAPI: vi.fn(),
  requireScopes: vi.fn(),
}))

import { GET } from '@/app/api/v1/github/installations/route'

const req = () => new Request('https://x.example/api/v1/github/installations') as any

function accessRow(id: number, accountLogin: string, repos: number, extra: Record<string, unknown> = {}) {
  return {
    installation: {
      id,
      accountLogin,
      accountType: 'Organization',
      repositorySelection: 'selected',
      suspendedAt: null,
      _count: { repos },
      ...extra,
    },
  }
}

describe('GET /api/v1/github/installations (AWTD-1114)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAPI).mockResolvedValue({ userId: 'user-1', source: 'session', scopes: ['*'] } as any)
    vi.mocked(requireScopes).mockImplementation(() => {})
  })

  it("lists every installation the user can act on, with each one's repo count", async () => {
    mockPrisma.gitHubInstallationAccess.findMany.mockResolvedValue([
      accessRow(111, 'acme', 6),
      accessRow(222, 'jonparis', 24, { accountType: 'User', repositorySelection: 'all' }),
    ])

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.installations).toEqual([
      { id: 111, accountLogin: 'acme', accountType: 'Organization', repositorySelection: 'selected', repoCount: 6, suspended: false },
      { id: 222, accountLogin: 'jonparis', accountType: 'User', repositorySelection: 'all', repoCount: 24, suspended: false },
    ])
  })

  it('reads only the signed-in user\'s access rows', async () => {
    mockPrisma.gitHubInstallationAccess.findMany.mockResolvedValue([])

    await GET(req())

    const where = mockPrisma.gitHubInstallationAccess.findMany.mock.calls[0][0].where
    expect(where).toEqual({ userId: 'user-1' })
    expect(unknownWhereFields('GitHubInstallationAccess', where)).toEqual([])
  })

  it('says when an installation is suspended rather than hiding it', async () => {
    mockPrisma.gitHubInstallationAccess.findMany.mockResolvedValue([
      accessRow(111, 'acme', 6, { suspendedAt: new Date('2026-10-01T00:00:00Z') }),
    ])

    const body = await (await GET(req())).json()

    expect(body.installations[0].suspended).toBe(true)
  })
})
