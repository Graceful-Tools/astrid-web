/**
 * @vitest-environment node
 *
 * RED for task 842601f2 — the last open half.
 *
 * The connect `state` names whoever STARTED the flow, so an attacker can mint
 * one for their own account and hand the victim the provider's authorize URL.
 * `callbackSessionConflicts` refuses that when the victim's browser is signed
 * in. Signed OUT, the callback had nothing to check against and filed the
 * victim's token on the attacker.
 *
 * So a signed-out callback must PARK the grant instead of spending it, and
 * redeem it against whoever then signs in. Every test below plants
 * `ATTACKER` in the state and asserts nothing is ever filed on them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const ATTACKER = 'attacker-who-minted-the-state'
const VICTIM = 'victim-who-approved-at-the-provider'

vi.mock('@/lib/brand/capabilities', () => ({ capabilityGate: () => null }))
vi.mock('@/lib/brand/config', () => ({ BRAND: { appName: 'Astrid', appUrlScheme: 'astrid' } }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

const getUnifiedSession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/session-utils', () => ({ getUnifiedSession }))

const completeIntegrationLink = vi.hoisted(() => vi.fn(async () => ({ ok: true, account: 'octocat' })))
vi.mock('@/lib/sync/link-integration', () => ({ completeIntegrationLink }))

vi.mock('@/lib/sync/github', () => ({ githubSyncConfigured: () => true }))
vi.mock('@/lib/sync/google', () => ({ googleSyncConfigured: () => true }))
vi.mock('@/lib/copilot/oauth', () => ({
  copilotOAuthConfigured: () => true,
  copilotIntegrationGate: () => null,
  verifyCopilotOAuthState: (s: string) => (s === 'state-naming-attacker' ? ATTACKER : null),
}))
vi.mock('@/lib/sync/oauth-state', () => ({
  verifyOAuthState: (s: string) => (s === 'state-naming-attacker' ? ATTACKER : null),
}))

const { GET: githubCallback } = await import('@/app/api/v1/integrations/github/callback/route')
const { GET: googleCallback } = await import('@/app/api/v1/integrations/google/callback/route')
const { GET: copilotCallback } = await import('@/app/api/v1/integrations/copilot/callback/route')
const { GET: resume } = await import('@/app/api/v1/integrations/resume/route')
const { PENDING_LINK_COOKIE, openPendingLink } = await import('@/lib/sync/pending-link')

const callbackReq = (provider: string) =>
  new NextRequest(`https://astrid.cc/api/v1/integrations/${provider}/callback?code=prov_code&state=state-naming-attacker`)

/** The seal the callback handed the victim's browser, read back off Set-Cookie. */
function sealFrom(res: Response): string {
  const setCookie = res.headers.get('set-cookie') ?? ''
  const match = new RegExp(`${PENDING_LINK_COOKIE}=([^;]+)`).exec(setCookie)
  return match?.[1] ?? ''
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')
  completeIntegrationLink.mockResolvedValue({ ok: true, account: 'octocat' })
})

describe.each([
  ['github', () => githubCallback],
  ['google', () => googleCallback],
  ['copilot', () => copilotCallback],
])('%s callback in a signed-out browser (task 842601f2)', (provider, handler) => {
  it('files nothing on the account the state names', async () => {
    getUnifiedSession.mockResolvedValue(null)

    await handler()(callbackReq(provider))

    expect(completeIntegrationLink).not.toHaveBeenCalled()
  })

  it('parks the grant in an HttpOnly cookie and sends the browser to sign in', async () => {
    getUnifiedSession.mockResolvedValue(null)

    const res = await handler()(callbackReq(provider))

    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain(PENDING_LINK_COOKIE)
    expect(setCookie.toLowerCase()).toContain('httponly')
    expect(res.headers.get('location') ?? '').toContain('/auth/signin')
  })

  it('parks the code and the provider, and no user id at all', async () => {
    getUnifiedSession.mockResolvedValue(null)

    const parked = openPendingLink(decodeURIComponent(sealFrom(await handler()(callbackReq(provider)))))

    expect(parked).toMatchObject({ provider, code: 'prov_code' })
    expect(JSON.stringify(parked)).not.toContain(ATTACKER)
  })
})

describe('resuming a parked link after sign-in (task 842601f2)', () => {
  const resumeReq = (seal: string) =>
    new NextRequest('https://astrid.cc/api/v1/integrations/resume', {
      headers: seal ? { cookie: `${PENDING_LINK_COOKIE}=${encodeURIComponent(seal)}` } : {},
    })

  it('files the token on whoever signed in, not on whoever started the flow', async () => {
    getUnifiedSession.mockResolvedValue(null)
    const seal = sealFrom(await githubCallback(callbackReq('github')))

    getUnifiedSession.mockResolvedValue({ user: { id: VICTIM } })
    await resume(resumeReq(seal))

    expect(completeIntegrationLink).toHaveBeenCalledOnce()
    expect(completeIntegrationLink).toHaveBeenCalledWith('github', VICTIM, 'prov_code', undefined)
  })

  it('carries the redirect_uri Google needs echoed on the exchange', async () => {
    getUnifiedSession.mockResolvedValue(null)
    const seal = sealFrom(await googleCallback(callbackReq('google')))

    getUnifiedSession.mockResolvedValue({ user: { id: VICTIM } })
    await resume(resumeReq(seal))

    expect(completeIntegrationLink).toHaveBeenCalledWith(
      'google',
      VICTIM,
      'prov_code',
      'https://astrid.cc/api/v1/integrations/google/callback',
    )
  })

  it('clears the cookie so one grant cannot be redeemed twice', async () => {
    getUnifiedSession.mockResolvedValue(null)
    const seal = sealFrom(await githubCallback(callbackReq('github')))

    getUnifiedSession.mockResolvedValue({ user: { id: VICTIM } })
    const res = await resume(resumeReq(seal))

    expect(res.headers.get('set-cookie') ?? '').toMatch(new RegExp(`${PENDING_LINK_COOKIE}=;|Max-Age=0`))
  })

  it('refuses when the browser is still signed out', async () => {
    getUnifiedSession.mockResolvedValue(null)
    const seal = sealFrom(await githubCallback(callbackReq('github')))

    const res = await resume(resumeReq(seal))

    expect(completeIntegrationLink).not.toHaveBeenCalled()
    expect(res.headers.get('location') ?? '').toContain('/auth/signin')
  })

  it('refuses without a parked grant, so the route is not a bare connect endpoint', async () => {
    getUnifiedSession.mockResolvedValue({ user: { id: VICTIM } })

    await resume(resumeReq(''))

    expect(completeIntegrationLink).not.toHaveBeenCalled()
  })

  it('refuses a forged seal', async () => {
    getUnifiedSession.mockResolvedValue({ user: { id: VICTIM } })

    await resume(resumeReq('bm90LWEtc2VhbA.deadbeef'))

    expect(completeIntegrationLink).not.toHaveBeenCalled()
  })
})

describe('the signed-in path is unchanged (task 842601f2)', () => {
  it('completes for the account that started its own link', async () => {
    getUnifiedSession.mockResolvedValue({ user: { id: ATTACKER } })

    await githubCallback(callbackReq('github'))

    expect(completeIntegrationLink).toHaveBeenCalledWith('github', ATTACKER, 'prov_code', undefined)
  })

  it('still refuses a browser signed in as a different account', async () => {
    getUnifiedSession.mockResolvedValue({ user: { id: VICTIM } })

    await githubCallback(callbackReq('github'))

    expect(completeIntegrationLink).not.toHaveBeenCalled()
  })
})
