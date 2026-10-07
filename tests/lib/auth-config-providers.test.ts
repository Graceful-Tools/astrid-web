/**
 * P2 (spec §6.2–§6.4) — NextAuth offers exactly the listed providers, and the
 * new ones sign in only through the shared linking rule.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'crypto'

const { linkFederatedIdentity } = vi.hoisted(() => ({ linkFederatedIdentity: vi.fn() }))
vi.mock('@/lib/auth/federated-identity-linking', () => ({ linkFederatedIdentity }))

const ORIGINAL_ENV = { ...process.env }

async function loadAuthConfig() {
  vi.resetModules()
  return (await import('@/lib/auth-config')).authConfig
}

describe('the NextAuth provider list follows NEXT_PUBLIC_BRAND_AUTH_PROVIDERS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    linkFederatedIdentity.mockResolvedValue(true)
  })
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
  })

  it('has no GitHub or SSO provider unless listed', async () => {
    delete process.env.NEXT_PUBLIC_BRAND_AUTH_PROVIDERS
    const ids = (await loadAuthConfig()).providers.map(p => p.id)
    expect(ids).not.toContain('github')
    expect(ids).not.toContain('sso')
  })

  it('registers GitHub and SSO when listed', async () => {
    process.env.NEXT_PUBLIC_BRAND_AUTH_PROVIDERS = 'github,sso,passkey'
    process.env.GITHUB_CLIENT_ID = 'Iv23test'
    process.env.GITHUB_CLIENT_SECRET = 'secret'
    process.env.AUTH_SSO_ISSUER = 'https://idp.acme.example'
    process.env.AUTH_SSO_CLIENT_ID = 'client'
    process.env.AUTH_SSO_CLIENT_SECRET = 'secret'
    process.env.AUTH_SSO_DOMAINS = 'acme.example'
    process.env.AUTH_SSO_LABEL = 'Acme SSO'

    const providers = (await loadAuthConfig()).providers
    expect(providers.map(p => p.id)).toEqual(['github', 'sso'])
    expect(providers.find(p => p.id === 'sso')?.name).toBe('Acme SSO')
  })

  it('signs a GitHub user in only on the verified primary email GitHub reports', async () => {
    process.env.NEXT_PUBLIC_BRAND_AUTH_PROVIDERS = 'github'
    process.env.GITHUB_CLIENT_ID = 'Iv23test'
    process.env.GITHUB_CLIENT_SECRET = 'secret'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { email: 'dev@example.com', primary: true, verified: false },
    ]), { status: 200 })))

    const config = await loadAuthConfig()
    await config.callbacks!.signIn!({
      user: { id: 'x', email: 'dev@example.com' },
      account: { provider: 'github', type: 'oauth', providerAccountId: '583231', access_token: 'ghu_x' },
      profile: { login: 'dev' },
    } as any)

    expect(linkFederatedIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'github', email: 'dev@example.com', emailTrust: 'none' }),
    )
  })

  it('treats a verified primary as verified', async () => {
    process.env.NEXT_PUBLIC_BRAND_AUTH_PROVIDERS = 'github'
    process.env.GITHUB_CLIENT_ID = 'Iv23test'
    process.env.GITHUB_CLIENT_SECRET = 'secret'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { email: 'other@example.com', primary: false, verified: true },
      { email: 'Dev@Example.com', primary: true, verified: true },
    ]), { status: 200 })))

    const config = await loadAuthConfig()
    await config.callbacks!.signIn!({
      user: { id: 'x', email: 'dev@example.com' },
      account: { provider: 'github', type: 'oauth', providerAccountId: '583231', access_token: 'ghu_x' },
      profile: {},
    } as any)

    expect(linkFederatedIdentity).toHaveBeenCalledWith(expect.objectContaining({ emailTrust: 'verified' }))
  })

  describe('Sign in with Apple on web (AWTD-1110)', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const appleWeb = {
      APPLE_SERVICES_ID: 'cc.astrid.web',
      APPLE_TEAM_ID: 'TEAM123456',
      APPLE_KEY_ID: 'KEY1234567',
      APPLE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }

    it('registers Apple when it is offered and the web credentials are set', async () => {
      process.env.NEXT_PUBLIC_BRAND_AUTH_PROVIDERS = 'apple,passkey'
      Object.assign(process.env, appleWeb)
      const apple = (await loadAuthConfig()).providers.find(p => p.id === 'apple') as any
      expect(apple).toBeDefined()
      expect(apple.options.clientId).toBe('cc.astrid.web')
      expect(apple.options.clientSecret.split('.')).toHaveLength(3)
    })

    it('does not register Apple without the web credentials — native Apple sign-in needs none', async () => {
      process.env.NEXT_PUBLIC_BRAND_AUTH_PROVIDERS = 'apple,passkey'
      for (const key of Object.keys(appleWeb)) delete process.env[key]
      const ids = (await loadAuthConfig()).providers.map(p => p.id)
      expect(ids).not.toContain('apple')
    })

    it('does not register Apple when the brand does not offer it', async () => {
      process.env.NEXT_PUBLIC_BRAND_AUTH_PROVIDERS = 'passkey'
      Object.assign(process.env, appleWeb)
      const ids = (await loadAuthConfig()).providers.map(p => p.id)
      expect(ids).not.toContain('apple')
    })

    it.each([
      [true, 'verified'],
      ['true', 'verified'],
      ['false', 'none'],
      [undefined, 'none'],
    ])('links on Apple’s email_verified=%s only as %s', async (claim, trust) => {
      process.env.NEXT_PUBLIC_BRAND_AUTH_PROVIDERS = 'apple'
      Object.assign(process.env, appleWeb)
      const config = await loadAuthConfig()
      await config.callbacks!.signIn!({
        user: { id: 'x', email: 'pat@privaterelay.appleid.com' },
        account: { provider: 'apple', type: 'oauth', providerAccountId: '001234.abcd.5678' },
        profile: { sub: '001234.abcd.5678', email: 'pat@privaterelay.appleid.com', email_verified: claim },
      } as any)
      expect(linkFederatedIdentity).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'apple', emailTrust: trust }),
      )
    })

    it('sends the PKCE and state cookies on Apple’s cross-site form_post callback in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      try {
        const cookies = (await loadAuthConfig()).cookies!
        for (const name of ['pkceCodeVerifier', 'state'] as const) {
          expect(cookies[name]?.options).toMatchObject({ sameSite: 'none', secure: true, httpOnly: true })
        }
      } finally {
        vi.unstubAllEnvs()
      }
    })
  })

  it('binds SSO identities to the configured domains', async () => {
    process.env.NEXT_PUBLIC_BRAND_AUTH_PROVIDERS = 'sso'
    process.env.AUTH_SSO_ISSUER = 'https://idp.acme.example'
    process.env.AUTH_SSO_CLIENT_ID = 'client'
    process.env.AUTH_SSO_CLIENT_SECRET = 'secret'
    process.env.AUTH_SSO_DOMAINS = 'acme.example, acme-labs.example'

    const config = await loadAuthConfig()
    await config.callbacks!.signIn!({
      user: { id: 'x', email: 'pat@acme.example' },
      account: { provider: 'sso', type: 'oauth', providerAccountId: 'sub-1' },
      profile: {},
    } as any)

    expect(linkFederatedIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'sso', emailTrust: 'domain-bound', allowedDomains: ['acme.example', 'acme-labs.example'] }),
    )
  })
})
