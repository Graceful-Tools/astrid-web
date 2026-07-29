/**
 * Whitelabel Phase 6 (task 97208a72) — build-time capability configuration.
 *
 * An enterprise deployment may want the product's front end with its own back-end
 * services: no Google sign-in, no Google Tasks sync, GitHub Issues but not MCP. These
 * tests pin the properties that make that safe to rely on:
 *
 *   1. defaults enable everything, so an existing deployment is unaffected;
 *   2. a disabled capability is refused SERVER-SIDE, not merely hidden — an unenforced
 *      switch is worse than no switch, because it reads as a security boundary;
 *   3. the refusal is 404, not 403, so a deployment does not disclose which features it
 *      has turned off;
 *   4. a build with no sign-in method at all fails loudly instead of locking everyone out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const CAP_PREFIX = 'NEXT_PUBLIC_BRAND_ENABLE_'

function clearCapabilityEnv() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith(CAP_PREFIX)) delete process.env[key]
  }
}

describe('capability defaults (task 97208a72)', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    clearCapabilityEnv()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('enables every capability when nothing is configured', async () => {
    const { CAPABILITIES } = await import('@/lib/brand/capabilities')

    for (const [key, value] of Object.entries(CAPABILITIES)) {
      expect(value, `${key} should default to enabled`).toBe(true)
    }
  })

  it('treats the documented falsey spellings as disabled', async () => {
    for (const spelling of ['false', 'FALSE', '0', 'off', 'no', ' false ']) {
      vi.resetModules()
      process.env.NEXT_PUBLIC_BRAND_ENABLE_MCP = spelling
      const { CAPABILITIES } = await import('@/lib/brand/capabilities')
      expect(CAPABILITIES.integrationMcp, `"${spelling}" should disable`).toBe(false)
    }
  })

  it('treats an empty or unrecognised value as enabled rather than disabled', async () => {
    // Failing open is right here: a typo must not silently remove a feature.
    for (const spelling of ['', '   ', 'true', 'yes', 'enabled', 'banana']) {
      vi.resetModules()
      process.env.NEXT_PUBLIC_BRAND_ENABLE_MCP = spelling
      const { CAPABILITIES } = await import('@/lib/brand/capabilities')
      expect(CAPABILITIES.integrationMcp, `"${spelling}" should stay enabled`).toBe(true)
    }
  })

  it('disables capabilities independently of one another', async () => {
    process.env.NEXT_PUBLIC_BRAND_ENABLE_SYNC_GOOGLE_TASKS = 'false'
    const { CAPABILITIES } = await import('@/lib/brand/capabilities')

    expect(CAPABILITIES.syncGoogleTasks).toBe(false)
    expect(CAPABILITIES.syncGithubIssues).toBe(true)
    expect(CAPABILITIES.integrationMcp).toBe(true)
  })
})

describe('capability enforcement is server-side (task 97208a72)', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    clearCapabilityEnv()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('capabilityGate returns nothing while the capability is enabled', async () => {
    const { capabilityGate } = await import('@/lib/brand/capabilities')
    expect(capabilityGate('syncGoogleTasks')).toBeNull()
  })

  it('capabilityGate answers 404 — not 403 — when disabled', async () => {
    process.env.NEXT_PUBLIC_BRAND_ENABLE_SYNC_GOOGLE_TASKS = 'false'
    const { capabilityGate } = await import('@/lib/brand/capabilities')

    const response = capabilityGate('syncGoogleTasks')
    expect(response).not.toBeNull()
    // 403 would confirm the endpoint exists and is merely withheld from this caller.
    expect(response!.status).toBe(404)
    await expect(response!.json()).resolves.toEqual({ error: 'Not found' })
  })

  it('withAuth refuses a disabled route WITHOUT authenticating', async () => {
    process.env.NEXT_PUBLIC_BRAND_ENABLE_SYNC_GOOGLE_TASKS = 'false'

    const authenticateAPI = vi.fn()
    vi.doMock('@/lib/api-auth-middleware', async () => {
      const actual = await vi.importActual<Record<string, unknown>>('@/lib/api-auth-middleware')
      return { ...actual, authenticateAPI }
    })

    const { withAuth } = await import('@/lib/api-auth-wrapper')
    const handler = vi.fn()
    const route = withAuth({ capability: 'syncGoogleTasks', tag: 'test' }, handler as never)

    const response = await route(
      new Request('https://example.test/api/v1/sync/google/tasks') as never,
      undefined as never
    )

    expect(response.status).toBe(404)
    expect(handler).not.toHaveBeenCalled()
    // Short-circuiting before auth is the point: no DB or token work for a route this
    // deployment does not serve.
    expect(authenticateAPI).not.toHaveBeenCalled()
  })

  it('withAuth leaves an enabled route on its normal path', async () => {
    const auth = { userId: 'user-1', scopes: ['tasks:read'], source: 'session' }
    vi.doMock('@/lib/api-auth-middleware', async () => {
      const actual = await vi.importActual<Record<string, unknown>>('@/lib/api-auth-middleware')
      return { ...actual, authenticateAPI: vi.fn().mockResolvedValue(auth) }
    })

    const { withAuth } = await import('@/lib/api-auth-wrapper')
    const { NextResponse } = await import('next/server')
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }))
    const route = withAuth({ capability: 'syncGoogleTasks', tag: 'test' }, handler as never)

    const response = await route(
      new Request('https://example.test/api/v1/sync/google/tasks') as never,
      undefined as never
    )

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })
})

describe('authentication configuration must stay usable (task 97208a72)', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    clearCapabilityEnv()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('lists the enabled sign-in methods', async () => {
    process.env.NEXT_PUBLIC_BRAND_ENABLE_AUTH_APPLE = 'false'
    const { enabledAuthMethods } = await import('@/lib/brand/capabilities')

    expect(enabledAuthMethods()).toEqual(['authGoogle', 'authPasskey'])
  })

  it('accepts a configuration with only one sign-in method', async () => {
    process.env.NEXT_PUBLIC_BRAND_ENABLE_AUTH_GOOGLE = 'false'
    process.env.NEXT_PUBLIC_BRAND_ENABLE_AUTH_APPLE = 'false'
    const { assertUsableAuthConfiguration } = await import('@/lib/brand/capabilities')

    expect(() => assertUsableAuthConfiguration()).not.toThrow()
  })

  it('throws when every sign-in method is disabled', async () => {
    process.env.NEXT_PUBLIC_BRAND_ENABLE_AUTH_GOOGLE = 'false'
    process.env.NEXT_PUBLIC_BRAND_ENABLE_AUTH_APPLE = 'false'
    process.env.NEXT_PUBLIC_BRAND_ENABLE_AUTH_PASSKEY = 'false'
    const { assertUsableAuthConfiguration } = await import('@/lib/brand/capabilities')

    // A build nobody can sign in to is an outage, not a degraded feature — it must fail
    // at startup rather than at the first user's sign-in attempt.
    expect(() => assertUsableAuthConfiguration()).toThrow(/no one could sign in/i)
  })
})

describe('discovery documents follow the capabilities (task 97208a72)', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    clearCapabilityEnv()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('advertises every integration by default', async () => {
    const { enabledIntegrationMethods, WELL_KNOWN_ENDPOINTS } =
      await import('@/lib/integration-registry')

    expect(enabledIntegrationMethods().map((m) => m.id)).toContain('mcp')
    expect(WELL_KNOWN_ENDPOINTS.map((e) => e.path)).toContain('/api/mcp/context')
  })

  it('omits a disabled integration rather than advertising a dead endpoint', async () => {
    process.env.NEXT_PUBLIC_BRAND_ENABLE_MCP = 'false'
    const { enabledIntegrationMethods, WELL_KNOWN_ENDPOINTS } =
      await import('@/lib/integration-registry')

    const ids = enabledIntegrationMethods().map((m) => m.id)
    expect(ids).not.toContain('mcp')
    // Unrelated integrations are untouched.
    expect(ids).toContain('rest-api')
    expect(WELL_KNOWN_ENDPOINTS.map((e) => e.path)).not.toContain('/api/mcp/context')
    expect(WELL_KNOWN_ENDPOINTS.map((e) => e.path)).toContain('/llms.txt')
  })
})

describe('GET /api/v1/capabilities (task 97208a72)', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    clearCapabilityEnv()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('reports everything available by default', async () => {
    const { GET } = await import('@/app/api/v1/capabilities/route')
    const body = await (await GET()).json()

    expect(body.auth).toEqual({ google: true, apple: true, passkey: true })
    expect(body.sync).toEqual({ googleTasks: true, githubIssues: true })
    expect(body.brand.appName).toBe('Astrid')
  })

  it('reflects what the deployment has turned off', async () => {
    process.env.NEXT_PUBLIC_BRAND_ENABLE_SYNC_GOOGLE_TASKS = 'false'
    process.env.NEXT_PUBLIC_BRAND_ENABLE_AUTH_GOOGLE = 'false'
    const { GET } = await import('@/app/api/v1/capabilities/route')
    const body = await (await GET()).json()

    expect(body.sync.googleTasks).toBe(false)
    expect(body.sync.githubIssues).toBe(true)
    expect(body.auth.google).toBe(false)
    expect(body.auth.passkey).toBe(true)
  })

  it('never discloses the agent email domain', async () => {
    // Clients compare agent identities the server returned; they must not build one.
    const { GET } = await import('@/app/api/v1/capabilities/route')
    const body = await (await GET()).json()

    expect(JSON.stringify(body)).not.toContain('agentEmailDomain')
  })

  // The brand block is what makes the SERVER the authority on brand text. One mobile
  // binary can point at several deployments, so a build-time-only brand on the client
  // is wrong for the same reason a build-time-only capability set was.

  it('serves the full brand text so a client can present the right brand', async () => {
    const { GET } = await import('@/app/api/v1/capabilities/route')
    const body = await (await GET()).json()

    expect(body.brand).toEqual({
      appName: 'Astrid',
      wordmark: 'astrid',
      slogan: 'Get it done!',
      agentName: 'Astrid',
    })
  })

  it('serves a rebranded deployment its own text', async () => {
    process.env.NEXT_PUBLIC_BRAND_NAME = 'Acme'
    process.env.NEXT_PUBLIC_BRAND_WORDMARK = 'ACME'
    process.env.NEXT_PUBLIC_BRAND_SLOGAN = 'Ship it.'
    process.env.NEXT_PUBLIC_BRAND_AGENT_NAME = 'Ada'

    const { GET } = await import('@/app/api/v1/capabilities/route')
    const body = await (await GET()).json()

    expect(body.brand).toEqual({
      appName: 'Acme',
      wordmark: 'ACME',
      slogan: 'Ship it.',
      agentName: 'Ada',
    })
    expect(JSON.stringify(body)).not.toContain('Astrid')
  })

  it('never discloses the brand domain or the accent colour', async () => {
    // Both are client-side decisions, not the server's to make:
    //   domain — a server naming "its" brand domain would be telling a client which
    //     cookies to clear and which Universal Links to claim.
    //   accentColor — clients resolve colours once at launch so no render parses a hex
    //     string; a server-driven accent would cost that on every colour read.
    const { GET } = await import('@/app/api/v1/capabilities/route')
    const body = await (await GET()).json()

    expect(Object.keys(body.brand).sort()).toEqual(
      ['agentName', 'appName', 'slogan', 'wordmark']
    )
  })
})
