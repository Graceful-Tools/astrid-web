/**
 * AWTD-1105: /auth/desktop honours a `provider` hint.
 *
 * The iOS and Mac apps show their own GitHub / SSO buttons and hand off to the
 * browser for them. A signed-out user who tapped "Sign in with GitHub" in the
 * app should go straight to GitHub, not land on the generic sign-in page and
 * pick the provider a second time. Anything the deployment does not offer, or
 * that cannot start without a click (passkey), keeps the old round-trip.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const getUnifiedSession = vi.hoisted(() => vi.fn())
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`)
  }),
)

vi.mock('@/lib/session-utils', () => ({ getUnifiedSession }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/brand/capabilities', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/brand/capabilities')>()),
  AUTH_PROVIDERS: ['google', 'apple', 'passkey', 'github'],
}))

const { default: DesktopHandoffPage } = await import('@/app/[locale]/auth/desktop/page')
const { DesktopProviderSignIn } = await import('@/app/[locale]/auth/desktop/desktop-provider-sign-in')

const CHALLENGE = 'a'.repeat(43)

function params(overrides: Record<string, string> = {}) {
  return Promise.resolve({
    client: 'ios',
    state: 'state-123',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...overrides,
  })
}

async function renderPage(overrides: Record<string, string> = {}) {
  return DesktopHandoffPage({ searchParams: params(overrides) })
}

beforeEach(() => {
  vi.clearAllMocks()
  getUnifiedSession.mockResolvedValue(null)
})

describe('/auth/desktop provider hint (AWTD-1105)', () => {
  it('starts an offered provider directly when the user is signed out', async () => {
    const page = (await renderPage({ provider: 'github' })) as React.ReactElement<{
      provider: string
      callbackUrl: string
    }>

    expect(redirect).not.toHaveBeenCalled()
    expect(page.type).toBe(DesktopProviderSignIn)
    expect(page.props.provider).toBe('github')

    // Sign-in comes back to this page with the app's parameters intact.
    const back = new URL(page.props.callbackUrl, 'https://example.test')
    expect(back.pathname).toBe('/auth/desktop')
    expect(back.searchParams.get('client')).toBe('ios')
    expect(back.searchParams.get('state')).toBe('state-123')
    expect(back.searchParams.get('code_challenge')).toBe(CHALLENGE)
  })

  it('falls back to the sign-in page for a provider this deployment does not offer', async () => {
    await expect(renderPage({ provider: 'sso' })).rejects.toThrow(/NEXT_REDIRECT \/auth\/signin\?/)
  })

  it('falls back to the sign-in page with no provider, as before', async () => {
    await expect(renderPage()).rejects.toThrow(/NEXT_REDIRECT \/auth\/signin\?/)
  })

  it('ignores the hint once signed in and offers the hand-off', async () => {
    getUnifiedSession.mockResolvedValue({ user: { id: 'u1', email: 'a@example.test' } })
    const page = (await renderPage({ provider: 'github' })) as React.ReactElement
    expect(redirect).not.toHaveBeenCalled()
    expect(page.type).not.toBe(DesktopProviderSignIn)
  })

  it('accepts the Mac client', async () => {
    const page = (await renderPage({ client: 'mac', provider: 'github' })) as React.ReactElement
    expect(page.type).toBe(DesktopProviderSignIn)
  })
})
