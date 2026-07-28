// @vitest-environment node
//
// Node, not the project default jsdom: these exercise SERVER route handlers, and under
// jsdom `typeof window !== 'undefined'` sends getBaseUrl() down its client branch, so
// it never reads NEXTAUTH_URL and the URL assertions below pass vacuously.
/**
 * Brand matrix — every profile in brands/ must produce a coherent deployment.
 *
 * Task 97208a72. Adding a partner means adding one `brands/*.brand.json`; this file
 * picks it up automatically and runs the same assertions against it. A failure here is a
 * real whitelabelling gap: something in the app is still assuming Astrid's values or
 * Astrid's enabled services.
 *
 * These exercise the REAL route handlers, invoked in-process — the same code Next runs,
 * with no HTTP server to boot. That keeps them fast enough to sit in predeploy while
 * still catching the thing unit tests on the config object alone would miss: a document
 * that renders the brand token literally, or a route that ignores its capability.
 *
 * `astrid.brand.json` is the regression guard. It sets no environment at all, so if the
 * refactor ever changes today's production behaviour, that profile fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

interface BrandProfile {
  name: string
  description: string
  env: Record<string, string>
  expect: {
    appName: string
    productTitle: string
    domain: string
    agentEmailDomain: string
    supportEmail: string
    inboundTaskEmail: string
    accentColor: string
    logo: string
    icon: string
    enabledAgents: string[]
    capabilities: Record<string, boolean>
    requireLiterals: string[]
    forbidLiterals: string[]
  }
}

const BRANDS_DIR = join(process.cwd(), 'brands')

const PROFILES: BrandProfile[] = readdirSync(BRANDS_DIR)
  .filter((f) => f.endsWith('.brand.json'))
  .map((f) => JSON.parse(readFileSync(join(BRANDS_DIR, f), 'utf8')))

/** Every brand/capability variable, cleared before each profile is applied. */
function clearBrandEnv() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('NEXT_PUBLIC_BRAND_') || key.startsWith('BRAND_')) delete process.env[key]
  }
}

it('finds the brand profiles', () => {
  // A glob that silently matches nothing would make every test below vacuously pass.
  expect(PROFILES.length).toBeGreaterThanOrEqual(2)
  expect(PROFILES.map((p) => p.name)).toEqual(expect.arrayContaining(['Astrid', 'Acme']))
})

describe.each(PROFILES)('brand profile: $name', (profile) => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    clearBrandEnv()
    Object.assign(process.env, profile.env)
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.resetModules()
  })

  it('derives the expected brand values', async () => {
    const { BRAND, brandOrigin } = await import('@/lib/brand/config')

    expect(BRAND.appName).toBe(profile.expect.appName)
    expect(BRAND.productTitle).toBe(profile.expect.productTitle)
    expect(BRAND.domain).toBe(profile.expect.domain)
    expect(BRAND.agentEmailDomain).toBe(profile.expect.agentEmailDomain)
    expect(BRAND.supportEmail).toBe(profile.expect.supportEmail)
    expect(BRAND.inboundTaskEmail).toBe(profile.expect.inboundTaskEmail)
    expect(BRAND.accentColor).toBe(profile.expect.accentColor)
    expect(brandOrigin()).toBe(`https://${profile.expect.domain}`)
  })

  it('points at this profile’s artwork', async () => {
    // The Acme preview shipped an Astrid logo on its sign-in page: the asset path was
    // hardcoded, and being lowercase-hyphenated it matched none of the brand-literal
    // patterns either. Task 97208a72.
    const { BRAND } = await import('@/lib/brand/config')

    expect(BRAND.logo).toBe(profile.expect.logo)
    expect(BRAND.icon).toBe(profile.expect.icon)
    for (const literal of profile.expect.forbidLiterals) {
      expect(BRAND.logo, `logo path leaks "${literal}"`).not.toContain(literal.toLowerCase())
    }
  })

  it('enables exactly the expected agents, at the expected domain', async () => {
    const { getAllAgentConfigs } = await import('@/lib/ai/agent-config')

    const emails = getAllAgentConfigs().map((a) => a.email).sort()
    const expected = profile.expect.enabledAgents
      .map((mailbox) => `${mailbox}@${profile.expect.agentEmailDomain}`)
      .sort()

    expect(emails).toEqual(expected)
  })

  it('reports the expected capabilities', async () => {
    const { CAPABILITIES } = await import('@/lib/brand/capabilities')

    for (const [key, expected] of Object.entries(profile.expect.capabilities)) {
      expect(CAPABILITIES[key as keyof typeof CAPABILITIES], `${key}`).toBe(expected)
    }
  })

  it('always leaves at least one way to sign in', async () => {
    const { assertUsableAuthConfiguration, enabledAuthMethods } =
      await import('@/lib/brand/capabilities')

    expect(() => assertUsableAuthConfiguration()).not.toThrow()
    expect(enabledAuthMethods().length).toBeGreaterThan(0)
  })

  it('serves a capabilities document matching the profile', async () => {
    const { GET } = await import('@/app/api/v1/capabilities/route')
    const body = await (await GET()).json()

    const caps = profile.expect.capabilities
    expect(body.auth).toEqual({
      google: caps.authGoogle,
      apple: caps.authApple,
      passkey: caps.authPasskey,
    })
    expect(body.sync).toEqual({
      googleTasks: caps.syncGoogleTasks,
      githubIssues: caps.syncGithubIssues,
    })
    expect(body.brand.appName).toBe(profile.expect.appName)
  })

  it('renders a PWA manifest with no unresolved tokens or foreign brands', async () => {
    const { GET } = await import('@/app/manifest.json/route')
    const body = await (await GET()).json()
    const rendered = JSON.stringify(body)

    expect(body.name).toBe(profile.expect.productTitle)
    expect(body.short_name).toBe(profile.expect.appName)
    expect(body.theme_color).toBe(profile.expect.accentColor)
    assertClean(rendered, profile, 'manifest')
  })

  it('renders llms.txt with no unresolved tokens or foreign brands', async () => {
    const { GET } = await import('@/app/llms.txt/route')
    const rendered = await (await GET()).text()

    expect(rendered).toContain(`# ${profile.expect.appName}`)
    // Agent identities must be advertised at this profile's agent domain.
    expect(rendered).toContain(`name@${profile.expect.agentEmailDomain}`)
    assertClean(rendered, profile, 'llms.txt')
  })

  it('emits no malformed URLs in llms.txt', async () => {
    // Regression: NEXTAUTH_URL is written with a trailing slash in production, and every
    // consumer concatenates a leading-slash path onto it, so /llms.txt shipped
    // `https://www.astrid.cc//docs/endpoints`. Local dev sets no trailing slash, which
    // is why only the preview deploy showed it. Task 97208a72.
    const ORIGINAL = process.env.NEXTAUTH_URL
    try {
      process.env.NEXTAUTH_URL = 'https://example.test/'
      vi.resetModules()
      const { GET } = await import('@/app/llms.txt/route')
      const rendered = await (await GET()).text()

      const doubleSlashed = rendered.match(/https?:\/\/[^\s)]*[^:]\/\//g) ?? []
      expect(doubleSlashed, `malformed URLs: ${doubleSlashed.join(', ')}`).toEqual([])
    } finally {
      if (ORIGINAL === undefined) delete process.env.NEXTAUTH_URL
      else process.env.NEXTAUTH_URL = ORIGINAL
    }
  })

  it('never points agents at an endpoint this profile disables', async () => {
    // A deployment with MCP off told agents to "POST to /api/mcp/operations" in the
    // Key Concepts prose, which 404s there. Caught on the Acme preview deploy.
    const { GET } = await import('@/app/llms.txt/route')
    const rendered = await (await GET()).text()

    if (!profile.expect.capabilities.integrationMcp) {
      expect(rendered).not.toContain('/api/mcp/')
      expect(rendered).not.toMatch(/\bMCP\b/)
    } else {
      expect(rendered).toContain('/api/mcp/operations')
    }
  })

  it('advertises only the integrations this profile enables', async () => {
    const { enabledIntegrationMethods, WELL_KNOWN_ENDPOINTS } =
      await import('@/lib/integration-registry')

    const ids = enabledIntegrationMethods().map((m) => m.id)
    const paths = WELL_KNOWN_ENDPOINTS.map((e) => e.path)

    expect(ids.includes('mcp')).toBe(profile.expect.capabilities.integrationMcp)
    expect(ids.includes('openclaw')).toBe(profile.expect.capabilities.integrationOpenClaw)
    expect(ids.includes('chatgpt')).toBe(profile.expect.capabilities.integrationChatGptActions)
    expect(paths.includes('/api/mcp/context')).toBe(profile.expect.capabilities.integrationMcp)
    // The REST API and llms.txt are unconditional.
    expect(ids).toContain('rest-api')
    expect(paths).toContain('/llms.txt')
  })

  it('renders localized copy with the profile brand and no leftover tokens', async () => {
    const { applyBrandToMessages } = await import('@/lib/brand/i18n-values')
    const en = (await import('@/lib/i18n/locales/en.json')).default
    const rendered = JSON.stringify(applyBrandToMessages(en))

    expect(rendered).not.toMatch(/\{appName\}|\{brandDomain\}|\{supportEmail\}|\{inboundTaskEmail\}/)
    assertClean(rendered, profile, 'en locale')
  })

  it('refuses a disabled capability’s route server-side', async () => {
    const { capabilityGate } = await import('@/lib/brand/capabilities')

    for (const [key, enabled] of Object.entries(profile.expect.capabilities)) {
      const gate = capabilityGate(key as never)
      if (enabled) {
        expect(gate, `${key} should be reachable`).toBeNull()
      } else {
        // Disabled means the route answers, and answers 404 — not merely hidden in UI.
        expect(gate, `${key} should be refused`).not.toBeNull()
        expect(gate!.status, `${key} should 404`).toBe(404)
      }
    }
  })
})

/**
 * Assert rendered output carries this profile's brand and none of the ones it forbids.
 *
 * `forbidLiterals` is what makes the Acme profile meaningful: a rebranded deployment
 * leaking "Astrid" or "astrid.cc" into a document is exactly the bug these tests exist
 * to catch, and it is invisible to a type checker.
 */
function assertClean(rendered: string, profile: BrandProfile, what: string) {
  for (const literal of profile.expect.requireLiterals) {
    expect(rendered, `${what} should mention ${literal}`).toContain(literal)
  }
  for (const literal of profile.expect.forbidLiterals) {
    expect(rendered, `${what} leaked "${literal}" for the ${profile.name} profile`)
      .not.toContain(literal)
  }
}
