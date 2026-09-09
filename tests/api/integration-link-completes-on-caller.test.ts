/**
 * RED for task 842601f2 — the app-completed integration link.
 *
 * The browser-completed flow files the provider token on whoever the HMAC
 * `state` names. An attacker can mint a state for their own account, hand the
 * victim the provider's authorize URL carrying it, and collect the victim's
 * repo-scoped token onto the attacker's account. `callbackSessionConflicts`
 * closes that only when the victim's browser happens to be signed in; a
 * signed-out victim still falls through, and the native flow is signed out by
 * construction (the app calls /authorize, the system browser has no cookie).
 *
 * The app-completed flow removes the question rather than answering it. The
 * provider redirects the code to the APP, on the victim's own device, and the
 * app posts it here authenticated as itself. There is no state, so there is
 * nothing for an attacker to forge: the token is filed on whoever holds the
 * credential that made this call, full stop.
 *
 * These tests exist so nobody "helpfully" reintroduces a caller-supplied owner.
 * Every one of them passes an attacker-controlled `userId`/`state` in the body
 * and asserts it is ignored.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// vi.importActual, not a plain import: this file MOCKS @/lib/brand/config, so an
// ordinary `import { BRAND }` would yield the mock — which declares only the two
// fields this file needs and has no `domain`, failing at runtime rather than at
// compile time. importActual reaches the real config past the mock (AWTD-867).
const { BRAND } = await vi.hoisted(
  async () => await vi.importActual<typeof import('@/lib/brand/config')>('@/lib/brand/config'),
)


const CALLER = 'victim-who-is-signed-in-to-the-app'
const ATTACKER = 'attacker-who-minted-the-state'

vi.mock('@/lib/api-auth-wrapper', () => ({
  withAuth: (_opts: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, ctx: unknown) =>
      handler(req, { userId: CALLER, scopes: ['tasks:write'], source: 'oauth' }, ctx),
}))

vi.mock('@/lib/brand/capabilities', () => ({ capabilityGate: () => null }))
vi.mock('@/lib/brand/config', () => ({
  BRAND: { appName: 'Astrid', appUrlScheme: 'astrid', domain: BRAND.domain },
}))

const exchangeGithubCode = vi.hoisted(() => vi.fn())
const storeGithubIntegration = vi.hoisted(() => vi.fn())
const githubRequest = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sync/github', () => ({
  githubSyncConfigured: () => true,
  exchangeGithubCode,
  storeGithubIntegration,
  githubRequest,
}))

// The browser flow's state is minted by the shared provider-tagged helper
// (task 842601f2). Stubbed so the assertions below can read the caller out of
// it without decoding base64url.
const mintOAuthState = vi.hoisted(() =>
  vi.fn((userId: string, provider: string) => `hmac-${provider}-state-naming-${userId}`),
)
vi.mock('@/lib/sync/oauth-state', () => ({ mintOAuthState, verifyOAuthState: vi.fn() }))

const exchangeGoogleCode = vi.hoisted(() => vi.fn())
const storeGoogleIntegration = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sync/google', () => ({
  googleSyncConfigured: () => true,
  exchangeGoogleCode,
  storeGoogleIntegration,
  googleAuthorizeURL: (state: string, redirectUri: string) =>
    `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
}))

const exchangeCopilotCode = vi.hoisted(() => vi.fn())
const storeCopilotCredential = vi.hoisted(() => vi.fn())
const githubLoginFor = vi.hoisted(() => vi.fn())
vi.mock('@/lib/copilot/oauth', () => ({
  copilotOAuthConfigured: () => true,
  copilotIntegrationGate: () => null,
  exchangeCopilotCode,
  storeCopilotCredential,
  githubLoginFor,
  mintCopilotOAuthState: () => `hmac-state-naming-${CALLER}`,
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

const { POST: githubComplete } = await import('@/app/api/v1/integrations/github/complete/route')
const { POST: googleComplete } = await import('@/app/api/v1/integrations/google/complete/route')
const { POST: copilotComplete } = await import('@/app/api/v1/integrations/copilot/complete/route')

const { GET: githubAuthorize } = await import('@/app/api/v1/integrations/github/authorize/route')
const { GET: googleAuthorize } = await import('@/app/api/v1/integrations/google/authorize/route')
const { GET: copilotAuthorize } = await import('@/app/api/v1/integrations/copilot/authorize/route')

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(`https://${BRAND.domain}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function get(url: string): NextRequest {
  return new NextRequest(`https://${BRAND.domain}${url}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  exchangeGithubCode.mockResolvedValue({ accessToken: 'gh-token', scopes: ['repo'] })
  githubRequest.mockResolvedValue({ status: 200, json: { login: 'octocat' } })
  exchangeGoogleCode.mockResolvedValue({
    access_token: 'g-token',
    refresh_token: 'g-refresh',
    expires_in: 3600,
    scope: 'https://www.googleapis.com/auth/tasks',
  })
  exchangeCopilotCode.mockResolvedValue({ accessToken: 'cp-token' })
  githubLoginFor.mockResolvedValue('octocat')
})

describe('POST /api/v1/integrations/*/complete files the token on the caller', () => {
  it('stores the GitHub token on the authenticated caller, not a body-supplied owner', async () => {
    const res = await githubComplete(
      post('/api/v1/integrations/github/complete', {
        code: 'provider-code',
        redirectUri: 'astrid://github/callback',
        // Anything an attacker could plant. None of it may be honoured.
        userId: ATTACKER,
        state: 'state-minted-for-the-attacker',
      }),
      undefined,
    )

    expect(res.status).toBe(200)
    expect(storeGithubIntegration).toHaveBeenCalledTimes(1)
    expect(storeGithubIntegration.mock.calls[0][0]).toBe(CALLER)
  })

  it('stores the Google token on the authenticated caller, not a body-supplied owner', async () => {
    const res = await googleComplete(
      post('/api/v1/integrations/google/complete', {
        code: 'provider-code',
        redirectUri: 'astrid://google-tasks/callback',
        userId: ATTACKER,
        state: 'state-minted-for-the-attacker',
      }),
      undefined,
    )

    expect(res.status).toBe(200)
    expect(storeGoogleIntegration).toHaveBeenCalledTimes(1)
    expect(storeGoogleIntegration.mock.calls[0][0]).toBe(CALLER)
  })

  it('stores the Copilot credential on the authenticated caller, not a body-supplied owner', async () => {
    const res = await copilotComplete(
      post('/api/v1/integrations/copilot/complete', {
        code: 'provider-code',
        redirectUri: 'astrid://copilot/callback',
        userId: ATTACKER,
        state: 'state-minted-for-the-attacker',
      }),
      undefined,
    )

    expect(res.status).toBe(200)
    expect(storeCopilotCredential).toHaveBeenCalledTimes(1)
    expect(storeCopilotCredential.mock.calls[0][0]).toBe(CALLER)
  })
})

describe('POST /api/v1/integrations/*/complete input handling', () => {
  it('rejects a missing code without calling the provider', async () => {
    const res = await githubComplete(
      post('/api/v1/integrations/github/complete', { redirectUri: 'astrid://github/callback' }),
      undefined,
    )

    expect(res.status).toBe(400)
    expect(exchangeGithubCode).not.toHaveBeenCalled()
  })

  it('rejects a redirectUri that is not this brand’s app scheme', async () => {
    // The app scheme is what makes this flow safe: the provider hands the code
    // to the app on the user's own device. A https:// or foreign-scheme
    // redirect means the code travelled somewhere else first.
    const res = await githubComplete(
      post('/api/v1/integrations/github/complete', {
        code: 'provider-code',
        redirectUri: 'https://attacker.example/callback',
      }),
      undefined,
    )

    expect(res.status).toBe(400)
    expect(exchangeGithubCode).not.toHaveBeenCalled()
  })

  it('surfaces a failed exchange as an error rather than storing nothing quietly', async () => {
    exchangeGithubCode.mockResolvedValue(null)

    const res = await githubComplete(
      post('/api/v1/integrations/github/complete', {
        code: 'expired-code',
        redirectUri: 'astrid://github/callback',
      }),
      undefined,
    )

    expect(res.status).toBe(400)
    expect(storeGithubIntegration).not.toHaveBeenCalled()
  })

  it('refuses a Google grant that did not include the Tasks scope', async () => {
    exchangeGoogleCode.mockResolvedValue({
      access_token: 'g-token',
      scope: 'https://www.googleapis.com/auth/userinfo.email',
    })

    const res = await googleComplete(
      post('/api/v1/integrations/google/complete', {
        code: 'provider-code',
        redirectUri: 'astrid://google-tasks/callback',
      }),
      undefined,
    )

    expect(res.status).toBe(400)
    expect(storeGoogleIntegration).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/integrations/*/authorize', () => {
  const cases = [
    { name: 'github', route: githubAuthorize, path: '/api/v1/integrations/github/authorize' },
    { name: 'google', route: googleAuthorize, path: '/api/v1/integrations/google/authorize' },
    { name: 'copilot', route: copilotAuthorize, path: '/api/v1/integrations/copilot/authorize' },
  ]

  for (const { name, route, path } of cases) {
    it(`${name}: an app-scheme redirectUri produces a state that names nobody`, async () => {
      const res = await route(get(`${path}?redirectUri=${encodeURIComponent(`astrid://${name}/callback`)}`), undefined)

      expect(res.status).toBe(200)
      const url = new URL((await res.json()).url)
      expect(url.searchParams.get('redirect_uri')).toBe(`astrid://${name}/callback`)
      // The whole point: nothing in the state identifies an account, so an
      // intercepted link confers no authority over anyone's integration.
      expect(url.searchParams.get('state')).not.toContain(CALLER)
    })

    it(`${name}: refuses a redirectUri that is not this brand's app scheme`, async () => {
      const res = await route(
        get(`${path}?redirectUri=${encodeURIComponent('https://attacker.example/callback')}`),
        undefined,
      )

      expect(res.status).toBe(400)
    })

    it(`${name}: without redirectUri keeps the browser flow's identifying state`, async () => {
      const res = await route(get(path), undefined)

      expect(res.status).toBe(200)
      const url = new URL((await res.json()).url)
      expect(url.searchParams.get('state')).toContain(CALLER)
      // GitHub and Copilot omit redirect_uri and use their registered callback;
      // Google sends the https one. Neither may point at the app scheme.
      expect(url.searchParams.get('redirect_uri') ?? '').not.toMatch(/^astrid:/)
    })
  }
})
