/**
 * AWTD-1111 (P3a): every place that learns something about a GitHub App
 * installation records it in GitHubInstallation / GitHubInstallationRepo, and
 * access is granted ONLY where GitHub has just proven it.
 *
 * Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §7.2–7.3. Until P3b moves the
 * remaining readers, `GitHubIntegration` is written alongside — these tests pin
 * the new writes, the existing tests pin the old ones.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mockPrisma, mockGetServerSession } from '../setup'
import { unknownWhereFields } from '../utils/prisma-where'

const appRequest = vi.fn()
const installationRequest = vi.fn()

vi.mock('@octokit/app', () => ({
  App: vi.fn().mockImplementation(function () {
    return {
      octokit: { request: appRequest },
      getInstallationOctokit: vi.fn().mockResolvedValue({ request: installationRequest }),
    }
  }),
}))

import { GET as setup } from '@/app/api/github/setup/route'
import { POST as disconnect } from '@/app/api/github/disconnect/route'
import {
  handleInstallationEvent,
  handleInstallationRepositoriesEvent,
} from '@/lib/github/webhooks/installation'
import { mintOAuthStateWithSubject } from '@/lib/sync/oauth-state'

const ME = 'test-user-id'
const INSTALLATION = 12_345

function getRequest(url: string) {
  return { url, headers: { get: () => null } } as any
}

function jsonRequest(url: string, body: unknown) {
  return { url, headers: { get: () => null }, json: async () => body } as any
}

function stubGithubUser(visibleInstallationIds: number[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('https://github.com/login/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'ghu_user_token' }), { status: 200 })
      }
      if (url.startsWith('https://api.github.com/user/installations')) {
        return new Response(
          JSON.stringify({ installations: visibleInstallationIds.map(id => ({ id })) }),
          { status: 200 },
        )
      }
      return new Response('unexpected', { status: 500 })
    }),
  )
}

const ACCOUNT = { login: 'acme', type: 'Organization', node_id: 'O_acme' }
const REPO = { id: 501, name: 'api', full_name: 'acme/api', default_branch: 'trunk', private: true, node_id: 'R_api' }

describe('the setup route records the installation and grants proven access (AWTD-1111)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GITHUB_APP_ID = '123'
    process.env.GITHUB_APP_PRIVATE_KEY = 'test-key'
    process.env.GITHUB_CLIENT_ID = 'Iv23test'
    process.env.GITHUB_CLIENT_SECRET = 'secret'
    process.env.NEXTAUTH_SECRET = 'test-nextauth-secret'
    mockGetServerSession.mockResolvedValue({
      user: { id: ME, name: 'Me', email: 'me@example.com' },
      expires: '2099-01-01T00:00:00.000Z',
    })
    appRequest.mockResolvedValue({
      data: { id: INSTALLATION, account: ACCOUNT, repository_selection: 'selected' },
    })
    installationRequest.mockResolvedValue({ data: { repositories: [REPO] } })
    mockPrisma.gitHubIntegration.findFirst.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.GITHUB_CLIENT_ID
    delete process.env.GITHUB_CLIENT_SECRET
  })

  it('writes the installation, its repos and an access row for the verified user', async () => {
    stubGithubUser([INSTALLATION])
    const state = mintOAuthStateWithSubject(ME, 'github-app', String(INSTALLATION))

    await setup(getRequest(`http://localhost/api/github/setup?code=abc&state=${state}`))

    expect(mockPrisma.gitHubInstallation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: INSTALLATION },
        create: expect.objectContaining({
          id: INSTALLATION,
          accountLogin: 'acme',
          accountType: 'Organization',
          accountNodeId: 'O_acme',
          repositorySelection: 'selected',
        }),
      }),
    )
    expect(mockPrisma.gitHubInstallationRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { repoId: BigInt(501) },
        create: expect.objectContaining({
          repoId: BigInt(501),
          installationId: INSTALLATION,
          fullName: 'acme/api',
          defaultBranch: 'trunk',
          private: true,
          nodeId: 'R_api',
        }),
      }),
    )
    expect(mockPrisma.gitHubInstallationAccess.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_installationId: { userId: ME, installationId: INSTALLATION } },
        create: expect.objectContaining({ userId: ME, installationId: INSTALLATION, source: 'verified' }),
      }),
    )
  })

  it('grants nothing when GitHub says the user cannot see the installation', async () => {
    stubGithubUser([999])
    const state = mintOAuthStateWithSubject(ME, 'github-app', String(INSTALLATION))

    await setup(getRequest(`http://localhost/api/github/setup?code=abc&state=${state}`))

    expect(mockPrisma.gitHubInstallationAccess.upsert).not.toHaveBeenCalled()
  })
})

describe('installation webhooks keep the installation model current (AWTD-1111)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('created: records the installation and its repos, but grants access to nobody', async () => {
    await handleInstallationEvent({
      action: 'created',
      installation: { id: INSTALLATION, account: ACCOUNT, repository_selection: 'all' },
      repositories: [{ id: 501, name: 'api', full_name: 'acme/api', private: false }],
    } as any)

    expect(mockPrisma.gitHubInstallation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: INSTALLATION } }),
    )
    expect(mockPrisma.gitHubInstallationRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ installationId: INSTALLATION, fullName: 'acme/api' }) }),
    )
    expect(mockPrisma.gitHubInstallationAccess.upsert).not.toHaveBeenCalled()
  })

  it('deleted: removes the installation (repos and access cascade) and the legacy links', async () => {
    await handleInstallationEvent({ action: 'deleted', installation: { id: INSTALLATION, account: ACCOUNT } } as any)

    const where = mockPrisma.gitHubInstallation.deleteMany.mock.calls[0][0].where
    expect(where).toEqual({ id: INSTALLATION })
    expect(unknownWhereFields('GitHubInstallation', where)).toEqual([])
    expect(mockPrisma.gitHubIntegration.deleteMany).toHaveBeenCalledWith({ where: { installationId: INSTALLATION } })
  })

  it('suspend / unsuspend: marks the installation', async () => {
    await handleInstallationEvent({ action: 'suspend', installation: { id: INSTALLATION, account: ACCOUNT } } as any)
    expect(mockPrisma.gitHubInstallation.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: INSTALLATION },
      data: { suspendedAt: expect.any(Date) },
    })

    await handleInstallationEvent({ action: 'unsuspend', installation: { id: INSTALLATION, account: ACCOUNT } } as any)
    expect(mockPrisma.gitHubInstallation.updateMany.mock.calls[1][0]).toMatchObject({
      where: { id: INSTALLATION },
      data: { suspendedAt: null },
    })
  })

  it('repositories added: recorded against THIS installation, in both stores', async () => {
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue([
      { id: 'gi-1', installationId: INSTALLATION, repositories: [] },
    ])

    await handleInstallationRepositoriesEvent({
      action: 'added',
      installation: { id: INSTALLATION, account: ACCOUNT },
      repositories_added: [{ id: 777, name: 'web', full_name: 'acme/web', private: true }],
      repositories_removed: [],
    } as any)

    expect(mockPrisma.gitHubInstallationRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { repoId: BigInt(777) },
        create: expect.objectContaining({ installationId: INSTALLATION, fullName: 'acme/web' }),
      }),
    )
    // The legacy copy used to drop installationId here, so the coding agent
    // fell back to the user's first installation for these repos.
    expect(mockPrisma.gitHubIntegration.update.mock.calls[0][0].data.repositories).toEqual([
      expect.objectContaining({ id: 777, fullName: 'acme/web', installationId: INSTALLATION, owner: 'acme' }),
    ])
  })

  it('repositories removed: deleted from this installation only', async () => {
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue([])

    await handleInstallationRepositoriesEvent({
      action: 'removed',
      installation: { id: INSTALLATION, account: ACCOUNT },
      repositories_added: [],
      repositories_removed: [{ id: 777, name: 'web', full_name: 'acme/web' }],
    } as any)

    const where = mockPrisma.gitHubInstallationRepo.deleteMany.mock.calls[0][0].where
    expect(where).toEqual({ installationId: INSTALLATION, repoId: { in: [BigInt(777)] } })
    expect(unknownWhereFields('GitHubInstallationRepo', where)).toEqual([])
  })
})

describe('disconnecting revokes access (AWTD-1111)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { id: ME, name: 'Me', email: 'me@example.com' },
      expires: '2099-01-01T00:00:00.000Z',
    })
    mockPrisma.gitHubIntegration.delete.mockResolvedValue({ installationId: INSTALLATION })
  })

  it('one installation', async () => {
    await disconnect(jsonRequest('http://localhost/api/github/disconnect', { installationId: INSTALLATION }))

    expect(mockPrisma.gitHubInstallationAccess.deleteMany).toHaveBeenCalledWith({
      where: { userId: ME, installationId: INSTALLATION },
    })
  })

  it('all of them', async () => {
    await disconnect(jsonRequest('http://localhost/api/github/disconnect', {}))

    expect(mockPrisma.gitHubInstallationAccess.deleteMany).toHaveBeenCalledWith({ where: { userId: ME } })
  })
})
