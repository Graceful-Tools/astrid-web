/**
 * AWTD-1302: signing in with GitHub through the brand's App gave the user an
 * Account row and nothing else — no App token, no installation access — so the
 * project picker had nothing to list (spec §7.2: sign-in "upserts this row";
 * §7.3: access is written "at sign-in or connect" from the user's own
 * `GET /user/installations`).
 *
 * `syncGithubAppAccess` is that write: it stores the user's App token and
 * grants access to every installation GitHub lists for it. Sign-in and the
 * setup route's "refresh my access" leg both call it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockPrisma, mockGetServerSession } from '../setup'
import { connectGithubAppAtSignIn, syncGithubAppAccess } from '@/lib/github/app-access'
import { mintOAuthStateWithSubject } from '@/lib/sync/oauth-state'

const ME = 'test-user-id'

const LISTED = [
  { id: 101, account: { login: 'acme', type: 'Organization', node_id: 'O_acme' }, repository_selection: 'all' },
  { id: 202, account: { login: 'me', type: 'User', node_id: 'U_me' }, repository_selection: 'selected' },
]

function stubGithub(installations = LISTED, opts: { installationsStatus?: number } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('https://github.com/login/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'ghu_exchanged', refresh_token: 'ghr_x', expires_in: 28800 }), { status: 200 })
    }
    if (url.startsWith('https://api.github.com/user/installations')) {
      return new Response(JSON.stringify({ total_count: installations.length, installations }), {
        status: opts.installationsStatus ?? 200,
      })
    }
    return new Response('unexpected', { status: 500 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('syncGithubAppAccess (AWTD-1302)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores the App token and grants every installation GitHub lists for the user', async () => {
    stubGithub()
    const granted = await syncGithubAppAccess(ME, { access_token: 'ghu_token', expires_in: 28800 }, '4242')

    expect(granted).toEqual([101, 202])
    expect(mockPrisma.integration.upsert).toHaveBeenCalledTimes(1)
    const tokenWrite = mockPrisma.integration.upsert.mock.calls[0][0]
    expect(tokenWrite.where).toEqual({ userId_provider: { userId: ME, provider: 'GITHUB' } })
    expect(tokenWrite.create.externalAccountId).toBe('4242')
    // Encrypted, never the raw token.
    expect(JSON.stringify(tokenWrite)).not.toContain('ghu_token')

    const recorded = mockPrisma.gitHubInstallation.upsert.mock.calls.map(c => c[0])
    expect(recorded.map(r => r.where.id)).toEqual([101, 202])
    expect(recorded[0].update).toMatchObject({ accountLogin: 'acme', accountType: 'Organization', accountNodeId: 'O_acme' })

    const grants = mockPrisma.gitHubInstallationAccess.upsert.mock.calls.map(c => c[0].where.userId_installationId)
    expect(grants).toEqual([
      { userId: ME, installationId: 101 },
      { userId: ME, installationId: 202 },
    ])
  })

  it('grants nothing when GitHub will not list installations for the token', async () => {
    stubGithub(LISTED, { installationsStatus: 401 })
    const granted = await syncGithubAppAccess(ME, { access_token: 'ghu_bad' })
    expect(granted).toEqual([])
    expect(mockPrisma.gitHubInstallationAccess.upsert).not.toHaveBeenCalled()
  })
})

describe('connectGithubAppAtSignIn (AWTD-1302)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('syncs access from a GitHub sign-in, deriving expiry from expires_at', async () => {
    stubGithub()
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    await connectGithubAppAtSignIn(ME, {
      provider: 'github',
      providerAccountId: '4242',
      access_token: 'ghu_signin',
      refresh_token: 'ghr_signin',
      expires_at: expiresAt,
      refresh_token_expires_in: 15897600,
    })
    expect(mockPrisma.integration.upsert).toHaveBeenCalledTimes(1)
    const expires = mockPrisma.integration.upsert.mock.calls[0][0].create.expiresAt as Date
    expect(Math.abs(expires.getTime() - expiresAt * 1000)).toBeLessThan(5000)
    expect(mockPrisma.gitHubInstallationAccess.upsert).toHaveBeenCalledTimes(2)
  })

  it('ignores other providers', async () => {
    const fetchMock = stubGithub()
    await connectGithubAppAtSignIn(ME, { provider: 'google', providerAccountId: 'g', access_token: 'ya29' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockPrisma.integration.upsert).not.toHaveBeenCalled()
  })

  it('never throws: a failed sync must not fail the sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await expect(
      connectGithubAppAtSignIn(ME, { provider: 'github', providerAccountId: '1', access_token: 'ghu' }),
    ).resolves.toBeUndefined()
  })
})

describe('/api/github/setup?sync=1 — "refresh my access" (spec §7.3, AWTD-1302)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GITHUB_CLIENT_ID = 'Iv23test'
    process.env.GITHUB_CLIENT_SECRET = 'secret'
    process.env.NEXTAUTH_SECRET = 'test-nextauth-secret'
    mockGetServerSession.mockResolvedValue({
      user: { id: ME, name: 'Me', email: 'me@example.com' },
      expires: '2099-01-01T00:00:00.000Z',
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.GITHUB_CLIENT_ID
    delete process.env.GITHUB_CLIENT_SECRET
  })

  const getRequest = (url: string) => ({ url, headers: { get: () => null } }) as any

  it('sends the user to authorize the App, with no installation id needed', async () => {
    const { GET } = await import('@/app/api/github/setup/route')
    const res = await GET(getRequest('http://localhost/api/github/setup?sync=1'))
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('https://github.com/login/oauth/authorize')
    expect(location).toContain('client_id=Iv23test')
  })

  it('on return, grants every installation GitHub lists and says so', async () => {
    stubGithub()
    const { GET } = await import('@/app/api/github/setup/route')
    const state = mintOAuthStateWithSubject(ME, 'github-app', 'sync')
    const res = await GET(getRequest(`http://localhost/api/github/setup?code=abc&state=${encodeURIComponent(state)}`))
    expect(res.headers.get('location')).toContain('/settings/connections?github=synced')
    expect(mockPrisma.gitHubInstallationAccess.upsert).toHaveBeenCalledTimes(2)
    expect(mockPrisma.integration.upsert).toHaveBeenCalledTimes(1)
  })

  it('returns to a same-site path when asked to', async () => {
    stubGithub()
    const { GET } = await import('@/app/api/github/setup/route')
    const leg1 = await GET(getRequest('http://localhost/api/github/setup?sync=1&return=%2F%3FconnectGithubProject%3D1'))
    const authorize = new URL(leg1.headers.get('location') ?? '')
    const state = authorize.searchParams.get('state') ?? ''
    const res = await GET(getRequest(`http://localhost/api/github/setup?code=abc&state=${encodeURIComponent(state)}`))
    expect(res.headers.get('location')).toBe('http://localhost/?connectGithubProject=1')
  })

  it('never returns off-site', async () => {
    stubGithub()
    const { GET } = await import('@/app/api/github/setup/route')
    const leg1 = await GET(getRequest('http://localhost/api/github/setup?sync=1&return=%2F%2Fevil.example'))
    const state = new URL(leg1.headers.get('location') ?? '').searchParams.get('state') ?? ''
    const res = await GET(getRequest(`http://localhost/api/github/setup?code=abc&state=${encodeURIComponent(state)}`))
    expect(res.headers.get('location')).toContain('http://localhost/settings/connections?github=synced')
  })
})
