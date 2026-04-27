import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockPrisma } from '../setup'
import { GET } from '@/app/api/v1/github/status/route'
import { authenticateAPI, requireScopes } from '@/lib/api-auth-middleware'

vi.mock('@/lib/api-auth-middleware', () => ({
  authenticateAPI: vi.fn(),
  requireScopes: vi.fn(),
}))

const mockAuthenticateAPI = vi.mocked(authenticateAPI)
const mockRequireScopes = vi.mocked(requireScopes)

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthenticateAPI.mockResolvedValue({
    userId: 'user-1',
    source: 'oauth',
    scopes: ['user:read'],
  } as any)
  mockRequireScopes.mockImplementation(() => {})
  mockPrisma.user.findUnique.mockResolvedValue({ mcpSettings: null } as any)
  mockPrisma.mCPToken.findMany.mockResolvedValue([] as any)
})

const req = () => new Request('https://x.example/api/v1/github/status') as any

describe('GET /api/v1/github/status — multi-integration parity', () => {
  it('aggregates installation IDs and repositories across all integrations', async () => {
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue([
      { installationId: 111, repositories: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] },
      { installationId: 222, repositories: [{ id: 3, name: 'c' }] },
    ] as any)

    const res = await GET(req())
    const body = await res.json()

    expect(body.isGitHubConnected).toBe(true)
    expect(body.installationCount).toBe(2)
    expect(body.repositoryCount).toBe(3)
    expect(body.githubIntegration.connectedInstallationIds).toEqual([111, 222])
    expect(body.githubIntegration.repositories).toHaveLength(3)
    // Backward-compat: installationId still points at the first integration.
    expect(body.githubIntegration.installationId).toBe(111)
  })

  it('returns null githubIntegration and zero counts when no integrations exist', async () => {
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue([] as any)

    const res = await GET(req())
    const body = await res.json()

    expect(body.isGitHubConnected).toBe(false)
    expect(body.installationCount).toBe(0)
    expect(body.repositoryCount).toBe(0)
    expect(body.githubIntegration).toBeNull()
  })

  it('skips integrations missing installationId but counts their repos', async () => {
    // Defensive: legacy rows may have repos but a null installationId.
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue([
      { installationId: 111, repositories: [{ id: 1 }] },
      { installationId: null, repositories: [{ id: 2 }] },
    ] as any)

    const res = await GET(req())
    const body = await res.json()

    expect(body.installationCount).toBe(1)
    expect(body.githubIntegration.connectedInstallationIds).toEqual([111])
    expect(body.repositoryCount).toBe(2)
  })
})
