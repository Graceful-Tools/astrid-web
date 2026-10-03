/**
 * Whitelabel Phase 2 (task 97208a72) — which agents a deployment supports, and the
 * domain their identities live at, are configuration rather than source.
 *
 * The registry used to be a hardcoded object literal keyed by `claude@astrid.cc` etc.,
 * with two API routes keeping their own duplicate copies of the built-in list. These
 * tests pin the properties that make the new build-from-config version safe:
 *   - with no env set, the registry is byte-for-byte what it always was;
 *   - BRAND_ENABLED_AGENTS genuinely narrows the set, and the routes follow;
 *   - the default assistant survives narrowing (tasks are already assigned to it);
 *   - a foreign agent-email domain resolves, including the OpenClaw `.oc@` pattern.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BRAND } from '@/lib/brand/config'

const findUniqueUser = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => findUniqueUser(...a) } },
}))

const BRAND_ENV = ['BRAND_ENABLED_AGENTS', 'BRAND_AGENT_EMAIL_DOMAIN', 'BRAND_ASSISTANT_SERVICE']

describe('agent registry defaults (task 97208a72)', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('NEXT_PUBLIC_BRAND_') || BRAND_ENV.includes(key)) delete process.env[key]
    }
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it(`registers exactly the historical agent set at the ${BRAND.domain} domain`, async () => {
    const { AI_AGENT_CONFIG } = await import('@/lib/ai/agent-config')

    expect(Object.keys(AI_AGENT_CONFIG).sort()).toEqual([
      `astrid@${BRAND.agentEmailDomain}`,
      `claude@${BRAND.agentEmailDomain}`,
      `copilot@${BRAND.agentEmailDomain}`,
      `gemini@${BRAND.agentEmailDomain}`,
      // Muse joined when Meta's Model API gave it a server executor (AWTD-1053).
      `muse@${BRAND.agentEmailDomain}`,
      `openai@${BRAND.agentEmailDomain}`,
      `openclaw@${BRAND.agentEmailDomain}`,
    ])
  })

  it('preserves each agent’s routing values', async () => {
    const { AI_AGENT_CONFIG, getAgentService, getAgentModel } = await import('@/lib/ai/agent-config')

    expect(AI_AGENT_CONFIG[`copilot@${BRAND.agentEmailDomain}`]).toMatchObject({
      service: 'copilot',
      model: 'gpt-4.1',
      agentType: 'copilot_agent',
      contextFile: 'ASTRID.md',
    })
    expect(getAgentService(`gemini@${BRAND.agentEmailDomain}`)).toBe('gemini')
    expect(getAgentModel(`openclaw@${BRAND.agentEmailDomain}`)).toBe('anthropic/claude-opus-4-5')
  })

  it('registers local Codex as a distinct assignable identity, not the cloud OpenAI provider', async () => {
    const { getAssignableAgentEmails } = await import('@/lib/ai/assignable-agents')
    const { getAgentConfig } = await import('@/lib/ai/agent-config')

    expect(getAssignableAgentEmails()).toContain(`codex@${BRAND.agentEmailDomain}`)
    expect(getAgentConfig(`codex@${BRAND.agentEmailDomain}`)).toBeNull()
    expect(getAgentConfig(`openai@${BRAND.agentEmailDomain}`)?.service).toBe('openai')
  })

  it('resolves {name}.oc@ addresses to the openclaw config', async () => {
    const { getAgentConfig, getAgentService } = await import('@/lib/ai/agent-config')

    expect(getAgentConfig(`buddy.oc@${BRAND.domain}`)?.agentType).toBe('openclaw_worker')
    expect(getAgentService(`buddy.oc@${BRAND.domain}`)).toBe('openclaw')
    expect(getAgentConfig('buddy.oc@elsewhere.example')).toBeNull()
  })
})

describe('BRAND_ENABLED_AGENTS narrows the supported set (task 97208a72)', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('NEXT_PUBLIC_BRAND_') || BRAND_ENV.includes(key)) delete process.env[key]
    }
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('enables only the requested agents', async () => {
    process.env.BRAND_ENABLED_AGENTS = 'claude'
    const { AI_AGENT_CONFIG, getAllAgentConfigs } = await import('@/lib/ai/agent-config')

    // astrid is the product's own assistant and is always retained.
    expect(Object.keys(AI_AGENT_CONFIG).sort()).toEqual([`astrid@${BRAND.agentEmailDomain}`, `claude@${BRAND.agentEmailDomain}`])
    expect(getAllAgentConfigs()).toHaveLength(2)
  })

  it('drops disabled agents from lookup entirely', async () => {
    process.env.BRAND_ENABLED_AGENTS = 'claude'
    const { getAgentConfig, isRegisteredAgent } = await import('@/lib/ai/agent-config')

    expect(getAgentConfig(`gemini@${BRAND.agentEmailDomain}`)).toBeNull()
    expect(isRegisteredAgent(`gemini@${BRAND.agentEmailDomain}`)).toBe(false)
    // Disabling openclaw must also stop the .oc@ pattern resolving.
    expect(getAgentConfig(`buddy.oc@${BRAND.domain}`)).toBeNull()
  })

  it('feeds the built-in list both available-agents routes iterate', async () => {
    process.env.BRAND_ENABLED_AGENTS = 'claude,gemini'
    const { getBuiltInAgents } = await import('@/lib/ai/agent-config')

    // astrid is added separately by the routes; openclaw comes from the database.
    expect(getBuiltInAgents()).toEqual([
      { email: `claude@${BRAND.agentEmailDomain}`, name: 'Claude', service: 'claude', image: '/api/v1/agent-icon/claude' },
      { email: `gemini@${BRAND.agentEmailDomain}`, name: 'Gemini', service: 'gemini', image: '/api/v1/agent-icon/gemini' },
    ])
  })

  it('tolerates whitespace, case and unknown names without throwing', async () => {
    process.env.BRAND_ENABLED_AGENTS = ' Claude , nonsense,, GEMINI '
    const { AI_AGENT_CONFIG } = await import('@/lib/ai/agent-config')

    expect(Object.keys(AI_AGENT_CONFIG).sort()).toEqual([
      `astrid@${BRAND.agentEmailDomain}`,
      `claude@${BRAND.agentEmailDomain}`,
      `gemini@${BRAND.agentEmailDomain}`,
    ])
  })

  it('treats an empty value as unset rather than as "no agents"', async () => {
    process.env.BRAND_ENABLED_AGENTS = '   '
    const { getAllAgentConfigs } = await import('@/lib/ai/agent-config')

    expect(getAllAgentConfigs()).toHaveLength(7)
  })
})

describe('agent identities follow the brand domain (task 97208a72)', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('NEXT_PUBLIC_BRAND_') || BRAND_ENV.includes(key)) delete process.env[key]
    }
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('builds the registry at the configured domain', async () => {
    process.env.BRAND_AGENT_EMAIL_DOMAIN = 'acme.example'
    const { AI_AGENT_CONFIG, getAgentService } = await import('@/lib/ai/agent-config')

    expect(AI_AGENT_CONFIG['claude@acme.example']).toBeDefined()
    expect(AI_AGENT_CONFIG[`claude@${BRAND.agentEmailDomain}`]).toBeUndefined()
    expect(getAgentService('gemini@acme.example')).toBe('gemini')
  })

  it('matches the OpenClaw pattern at the configured domain only', async () => {
    process.env.BRAND_AGENT_EMAIL_DOMAIN = 'acme.example'
    const {
      customAgentEmail,
      isCustomAgentEmail,
      isOpenClawAgentEmail,
      isBrandAgentEmail,
      openClawAgentEmail,
    } =
      await import('@/lib/brand/agent-emails')

    expect(customAgentEmail('buddy')).toBe('buddy.oc@acme.example')
    expect(isCustomAgentEmail('buddy.oc@acme.example')).toBe(true)
    expect(openClawAgentEmail('buddy')).toBe('buddy.oc@acme.example')
    expect(isOpenClawAgentEmail('buddy.oc@acme.example')).toBe(true)
    expect(isOpenClawAgentEmail(`buddy.oc@${BRAND.domain}`)).toBe(false)
    expect(isBrandAgentEmail('claude@acme.example')).toBe(true)
    expect(isBrandAgentEmail('someone@gmail.com')).toBe(false)
    expect(isBrandAgentEmail(null)).toBe(false)
  })

  it('does not let a dotted subdomain smuggle past the OpenClaw pattern', async () => {
    process.env.BRAND_AGENT_EMAIL_DOMAIN = 'acme.example'
    const { isOpenClawAgentEmail } = await import('@/lib/brand/agent-emails')

    // The domain is escaped, so `.` is literal and cannot match an arbitrary char.
    expect(isOpenClawAgentEmail('buddy.oc@acmeXexample')).toBe(false)
    expect(isOpenClawAgentEmail('buddy.oc@evil.com/acme.example')).toBe(false)
  })

  it('names the default assistant after the brand', async () => {
    process.env.NEXT_PUBLIC_BRAND_NAME = 'Acme'
    process.env.BRAND_AGENT_EMAIL_DOMAIN = 'acme.example'
    const { AI_AGENT_CONFIG } = await import('@/lib/ai/agent-config')

    expect(AI_AGENT_CONFIG['astrid@acme.example'].displayName).toBe('Acme')
    // Provider-named agents keep their own names — a fork does not rename Claude.
    expect(AI_AGENT_CONFIG['claude@acme.example'].displayName).toBe('Claude Agent')
  })
})

/**
 * AWTD-1056: a white label chooses which provider backs its own assistant — the
 * `astrid@` identity, the brand's equivalent of Astrid. It was pinned to Claude, so
 * a deployment that offered only OpenAI still routed its assistant to Claude.
 */
describe('BRAND_ASSISTANT_SERVICE picks the assistant provider (AWTD-1056)', () => {
  const ORIGINAL_ENV = { ...process.env }
  const ASSISTANT = `astrid@${BRAND.agentEmailDomain}`

  beforeEach(() => {
    vi.resetModules()
    findUniqueUser.mockReset()
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('NEXT_PUBLIC_BRAND_') || BRAND_ENV.includes(key)) delete process.env[key]
    }
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('keeps Claude when nothing is configured', async () => {
    const { AI_AGENT_CONFIG, BRAND_ASSISTANT_SERVICE } = await import('@/lib/ai/agent-config')

    expect(BRAND_ASSISTANT_SERVICE).toBe('claude')
    expect(AI_AGENT_CONFIG[ASSISTANT]).toMatchObject({ service: 'claude', model: 'claude-sonnet-4-6' })
  })

  it('routes the assistant to the configured provider and its default model', async () => {
    process.env.BRAND_ASSISTANT_SERVICE = ' OpenAI '
    const { AI_AGENT_CONFIG, getAgentService, agentEmailForService } = await import('@/lib/ai/agent-config')

    expect(AI_AGENT_CONFIG[ASSISTANT]).toMatchObject({ service: 'openai', model: 'gpt-4o' })
    expect(getAgentService(ASSISTANT)).toBe('openai')
    // The real openai@ agent still owns its service; the assistant must not shadow it.
    expect(agentEmailForService('openai')).toBe(`openai@${BRAND.agentEmailDomain}`)
  })

  it('ignores a provider the deployment does not enable, falling back to an enabled one', async () => {
    process.env.BRAND_ENABLED_AGENTS = 'gemini'
    process.env.BRAND_ASSISTANT_SERVICE = 'openai'
    const { BRAND_ASSISTANT_SERVICE } = await import('@/lib/ai/agent-config')

    expect(BRAND_ASSISTANT_SERVICE).toBe('gemini')
  })

  it('falls back to the first enabled provider when unset and Claude is disabled', async () => {
    process.env.BRAND_ENABLED_AGENTS = 'copilot,gemini'
    const { BRAND_ASSISTANT_SERVICE } = await import('@/lib/ai/agent-config')

    expect(BRAND_ASSISTANT_SERVICE).toBe('gemini')
  })

  it('rejects names that are not providers — harnesses and custom agents cannot back it', async () => {
    process.env.BRAND_ASSISTANT_SERVICE = 'codex'
    const first = await import('@/lib/ai/agent-config')
    expect(first.BRAND_ASSISTANT_SERVICE).toBe('claude')

    vi.resetModules()
    process.env.BRAND_ASSISTANT_SERVICE = 'openclaw'
    const second = await import('@/lib/ai/agent-config')
    expect(second.BRAND_ASSISTANT_SERVICE).toBe('claude')
  })

  it('is the preferred service for a user who has not chosen one', async () => {
    process.env.BRAND_ASSISTANT_SERVICE = 'gemini'
    findUniqueUser.mockResolvedValue({ aiAssistantSettings: null, mcpSettings: null })
    const { getPreferredAIService } = await import('@/lib/api-key-cache')

    expect(await getPreferredAIService('user-1')).toBe('gemini')
  })

  it('is the fallback when the user has settings but no preference and no keys', async () => {
    process.env.BRAND_ASSISTANT_SERVICE = 'copilot'
    findUniqueUser.mockResolvedValue({ aiAssistantSettings: '{}', mcpSettings: null })
    const { getPreferredAIService } = await import('@/lib/api-key-cache')

    expect(await getPreferredAIService('user-1')).toBe('copilot')
  })

  it('never overrides a service the user picked', async () => {
    process.env.BRAND_ASSISTANT_SERVICE = 'gemini'
    findUniqueUser.mockResolvedValue({ aiAssistantSettings: JSON.stringify({ preferredService: 'openai' }) })
    const { getPreferredAIService } = await import('@/lib/api-key-cache')

    expect(await getPreferredAIService('user-1')).toBe('openai')
  })
})
