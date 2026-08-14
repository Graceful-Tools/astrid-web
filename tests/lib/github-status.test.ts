/**
 * Task e0613ae5 — fifth slice of collapsing the duplicated legacy↔v1 routes.
 *
 * `GET /api/github/status` and its v1 twin were two independent copies. This
 * pair is the odd one out: the two responses are identical (v1 adds no `meta`
 * envelope), so it is the only pair so far where a re-export would nearly work
 * — and it still should not, because legacy takes a session while v1 enforces a
 * `user:read` scope, and re-exporting would apply that scope check to legacy
 * OAuth callers who have never had one.
 *
 * The aggregation rules are worth pinning: multiple GitHub installations must
 * all be counted, and "which AI providers are available" is not simply "which
 * keys does the user hold".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    gitHubIntegration: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    mCPToken: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/copilot/oauth', () => ({ hasCopilotCredential: vi.fn() }))

import { getGitHubStatus } from '@/lib/github-status'
import { prisma } from '@/lib/prisma'
import { hasCopilotCredential } from '@/lib/copilot/oauth'

const mockPrisma = vi.mocked(prisma)
const mockCopilot = vi.mocked(hasCopilotCredential)

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.gitHubIntegration.findMany.mockResolvedValue([] as never)
  mockPrisma.user.findUnique.mockResolvedValue({ mcpSettings: null } as never)
  mockPrisma.mCPToken.findMany.mockResolvedValue([] as never)
  mockCopilot.mockResolvedValue(false as never)
})

describe('getGitHubStatus (task e0613ae5)', () => {
  it('reports a disconnected, unconfigured user', async () => {
    const status = await getGitHubStatus('u-1', 'test')

    expect(status).toMatchObject({
      isGitHubConnected: false,
      hasAIKeys: false,
      hasMCPToken: false,
      repositoryCount: 0,
      installationCount: 0,
      isFullyConfigured: false,
      githubIntegration: null,
      aiProviders: [],
    })
  })

  it('aggregates across MULTIPLE installations rather than picking one', async () => {
    // The bug v1's comment records: findFirst hid additional org installations
    // from the client. Both copies fixed it; the fix now exists once.
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue([
      { installationId: 111, repositories: [{ id: 'r1' }, { id: 'r2' }] },
      { installationId: 222, repositories: [{ id: 'r3' }] },
    ] as never)

    const status = await getGitHubStatus('u-1', 'test')

    expect(status.installationCount).toBe(2)
    expect(status.repositoryCount).toBe(3)
    expect(status.githubIntegration?.connectedInstallationIds).toEqual([111, 222])
    // Primary installation stays first for older clients.
    expect(status.githubIntegration?.installationId).toBe(111)
  })

  it('skips an integration row that has no installation id', async () => {
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue([
      { installationId: null, repositories: [{ id: 'r1' }] },
    ] as never)

    const status = await getGitHubStatus('u-1', 'test')

    expect(status.isGitHubConnected).toBe(false)
    expect(status.installationCount).toBe(0)
    // ...but its repositories are still counted, as both originals did.
    expect(status.repositoryCount).toBe(1)
  })

  it('counts only providers whose key is actually encrypted', async () => {
    // `mcpSettings` is `String?` in schema.prisma, so this arrives as JSON
    // text, not an object.
    mockPrisma.user.findUnique.mockResolvedValue({
      mcpSettings: JSON.stringify({
        apiKeys: {
          claude: { encrypted: 'x' },
          openai: {},                 // present but never configured
          somethingElse: { encrypted: 'x' }, // not a supported provider
        },
      }),
    } as never)

    const status = await getGitHubStatus('u-1', 'test')

    expect(status.userApiKeys).toEqual(['claude'])
    expect(status.hasAIKeys).toBe(true)
  })

  it('offers every provider once GitHub is connected, regardless of user keys', async () => {
    // Coding workflows run on the worker's keys, so connection — not the
    // user's own keys — is what unlocks the providers.
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue([
      { installationId: 111, repositories: [] },
    ] as never)

    const status = await getGitHubStatus('u-1', 'test')

    expect(status.aiProviders).toEqual(['claude', 'openai', 'gemini'])
    expect(status.userApiKeys).toEqual([])
  })

  it('includes copilot only when THIS user holds the credential', async () => {
    // Copilot is per-user OAuth, so it is the one provider the worker's keys
    // cannot supply.
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue([
      { installationId: 111, repositories: [] },
    ] as never)
    mockCopilot.mockResolvedValue(true as never)

    const status = await getGitHubStatus('u-1', 'test')

    expect(status.aiProviders).toEqual(['claude', 'openai', 'gemini', 'copilot'])
    expect(status.userApiKeys).toContain('copilot')
  })

  it('survives malformed stored settings instead of throwing', async () => {
    // Legacy hand-rolled JSON.parse here, which turns a corrupt settings blob
    // into a 500 on a read-only status check. v1 validated; that is the version
    // kept.
    mockPrisma.user.findUnique.mockResolvedValue({ mcpSettings: 'not json{' } as never)

    const status = await getGitHubStatus('u-1', 'test')

    expect(status.userApiKeys).toEqual([])
    expect(status.hasAIKeys).toBe(false)
  })

  it('is fully configured only with BOTH a connection and an MCP token', async () => {
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue([
      { installationId: 111, repositories: [] },
    ] as never)
    mockPrisma.mCPToken.findMany.mockResolvedValue([] as never)

    expect((await getGitHubStatus('u-1', 'test')).isFullyConfigured).toBe(false)

    mockPrisma.mCPToken.findMany.mockResolvedValue([{ id: 't1' }] as never)

    expect((await getGitHubStatus('u-1', 'test')).isFullyConfigured).toBe(true)
  })
})
