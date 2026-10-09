/**
 * Regression for AWTD-1087 (task 141c43e7): any signed-in user could claim any
 * unclaimed installation of the GitHub App, and then drive the coding agent
 * with that org's installation token.
 *
 * The rule these tests pin: an installation is linked to an Astrid user ONLY
 * when GitHub itself says that user can see it — `GET /user/installations`
 * with the user's own token. "Nobody else has claimed it" is not ownership,
 * and an `installation_id` in a query string is not proof of anything.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mockPrisma, mockGetServerSession } from '../setup'

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

import { GET as listInstallations } from '@/app/api/github/installations/route'
import { POST as manualSetup } from '@/app/api/github/manual-setup/route'
import { GET as setup } from '@/app/api/github/setup/route'
import { mintOAuthStateWithSubject } from '@/lib/sync/oauth-state'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ME = 'test-user-id'
const VICTIM_INSTALLATION = 99_000_001
const MY_INSTALLATION = 12_345

function jsonRequest(url: string, body: unknown) {
  return { url, headers: { get: () => null }, json: async () => body } as any
}

function getRequest(url: string) {
  return { url, headers: { get: () => null } } as any
}

/** GitHub's OAuth token endpoint + /user/installations, as the user sees them. */
function stubGithubUser(visibleInstallationIds: number[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('https://github.com/login/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'ghu_user_token' }), { status: 200 })
    }
    if (url.startsWith('https://api.github.com/user/installations')) {
      return new Response(
        JSON.stringify({
          total_count: visibleInstallationIds.length,
          installations: visibleInstallationIds.map(id => ({ id })),
        }),
        { status: 200 },
      )
    }
    return new Response('unexpected', { status: 500 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('GitHub App installations cannot be claimed without proof (AWTD-1087)', () => {
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
    appRequest.mockImplementation(async (route: string) => {
      if (route === 'GET /app/installations') {
        return { data: [{ id: VICTIM_INSTALLATION, account: { login: 'victim-org' } }] }
      }
      return { data: { id: VICTIM_INSTALLATION, account: { login: 'victim-org' } } }
    })
    installationRequest.mockResolvedValue({ data: { repositories: [] } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.GITHUB_CLIENT_ID
    delete process.env.GITHUB_CLIENT_SECRET
  })

  it('never lists installations the user has not linked', async () => {
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue([])

    const res = await listInstallations(getRequest('http://localhost/api/github/installations'))
    const body = await res.json()

    expect(body.detectedInstallations).toEqual([])
    expect(JSON.stringify(body)).not.toContain('victim-org')
    expect(appRequest).not.toHaveBeenCalledWith('GET /app/installations')
  })

  it('has no route that links an installation by id alone', () => {
    // connect-installation linked whatever id it was handed once nobody else
    // had. It existed only to serve the "detected installations" list, which
    // is gone; linking goes through /api/github/setup and GitHub's own answer.
    expect(existsSync(join(process.cwd(), 'app/api/github/connect-installation/route.ts'))).toBe(false)
  })

  it('refuses manual setup outside development, server-side', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const res = await manualSetup(
        jsonRequest('http://localhost/api/github/manual-setup', { installationId: VICTIM_INSTALLATION }),
      )
      expect(res.status).toBe(404)
      expect(mockPrisma.gitHubIntegration.upsert).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('does not link from a bare installation_id — it sends the user to GitHub to prove access', async () => {
    const res = await setup(
      getRequest(`http://localhost/api/github/setup?installation_id=${VICTIM_INSTALLATION}&setup_action=install`),
    )

    expect(mockPrisma.gitHubIntegration.upsert).not.toHaveBeenCalled()
    const location = res.headers.get('location') ?? ''
    expect(location).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/)
    expect(new URL(location).searchParams.get('client_id')).toBe('Iv23test')
  })

  it('refuses when GitHub says the user cannot see the installation', async () => {
    stubGithubUser([MY_INSTALLATION])
    const state = mintOAuthStateWithSubject(ME, 'github-app', String(VICTIM_INSTALLATION))

    const res = await setup(getRequest(`http://localhost/api/github/setup?code=abc&state=${state}`))

    expect(mockPrisma.gitHubIntegration.upsert).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toContain('github=not_authorized')
  })

  it('links when GitHub says the user can see the installation', async () => {
    stubGithubUser([MY_INSTALLATION])
    const state = mintOAuthStateWithSubject(ME, 'github-app', String(MY_INSTALLATION))

    const res = await setup(getRequest(`http://localhost/api/github/setup?code=abc&state=${state}`))

    expect(mockPrisma.gitHubIntegration.upsert).toHaveBeenCalledTimes(1)
    expect(mockPrisma.gitHubIntegration.upsert.mock.calls[0][0].create).toMatchObject({
      userId: ME,
      installationId: MY_INSTALLATION,
    })
    expect(res.headers.get('location')).toContain('github=connected')
  })

  it('refuses a state minted for a different Astrid user', async () => {
    stubGithubUser([MY_INSTALLATION])
    const state = mintOAuthStateWithSubject('someone-else', 'github-app', String(MY_INSTALLATION))

    await setup(getRequest(`http://localhost/api/github/setup?code=abc&state=${state}`))

    expect(mockPrisma.gitHubIntegration.upsert).not.toHaveBeenCalled()
  })

  it('fails closed when the App has no OAuth credentials to verify with', async () => {
    delete process.env.GITHUB_CLIENT_ID
    delete process.env.GITHUB_CLIENT_SECRET
    {
      const res = await setup(
        getRequest(`http://localhost/api/github/setup?installation_id=${MY_INSTALLATION}&setup_action=install`),
      )
      expect(mockPrisma.gitHubIntegration.upsert).not.toHaveBeenCalled()
      expect(res.headers.get('location')).toContain('github=verification_unavailable')
    }
  })
})
