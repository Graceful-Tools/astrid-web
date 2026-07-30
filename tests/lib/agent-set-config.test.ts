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

const BRAND_ENV = ['BRAND_ENABLED_AGENTS', 'BRAND_AGENT_EMAIL_DOMAIN']

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

  it('registers exactly the historical agent set at the astrid.cc domain', async () => {
    const { AI_AGENT_CONFIG } = await import('@/lib/ai/agent-config')

    expect(Object.keys(AI_AGENT_CONFIG).sort()).toEqual([
      'astrid@astrid.cc',
      'claude@astrid.cc',
      'copilot@astrid.cc',
      'gemini@astrid.cc',
      'openai@astrid.cc',
      'openclaw@astrid.cc',
    ])
  })

  it('preserves each agent’s routing values', async () => {
    const { AI_AGENT_CONFIG, getAgentService, getAgentModel } = await import('@/lib/ai/agent-config')

    expect(AI_AGENT_CONFIG['copilot@astrid.cc']).toMatchObject({
      service: 'copilot',
      model: 'gpt-4.1',
      agentType: 'copilot_agent',
      contextFile: 'ASTRID.md',
    })
    expect(getAgentService('gemini@astrid.cc')).toBe('gemini')
    expect(getAgentModel('openclaw@astrid.cc')).toBe('anthropic/claude-opus-4-5')
  })

  it('resolves {name}.oc@ addresses to the openclaw config', async () => {
    const { getAgentConfig, getAgentService } = await import('@/lib/ai/agent-config')

    expect(getAgentConfig('buddy.oc@astrid.cc')?.agentType).toBe('openclaw_worker')
    expect(getAgentService('buddy.oc@astrid.cc')).toBe('openclaw')
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
    expect(Object.keys(AI_AGENT_CONFIG).sort()).toEqual(['astrid@astrid.cc', 'claude@astrid.cc'])
    expect(getAllAgentConfigs()).toHaveLength(2)
  })

  it('drops disabled agents from lookup entirely', async () => {
    process.env.BRAND_ENABLED_AGENTS = 'claude'
    const { getAgentConfig, isRegisteredAgent } = await import('@/lib/ai/agent-config')

    expect(getAgentConfig('gemini@astrid.cc')).toBeNull()
    expect(isRegisteredAgent('gemini@astrid.cc')).toBe(false)
    // Disabling openclaw must also stop the .oc@ pattern resolving.
    expect(getAgentConfig('buddy.oc@astrid.cc')).toBeNull()
  })

  it('feeds the built-in list both available-agents routes iterate', async () => {
    process.env.BRAND_ENABLED_AGENTS = 'claude,gemini'
    const { getBuiltInAgents } = await import('@/lib/ai/agent-config')

    // astrid is added separately by the routes; openclaw comes from the database.
    expect(getBuiltInAgents()).toEqual([
      { email: 'claude@astrid.cc', name: 'Claude', service: 'claude', image: '/api/v1/agent-icon/claude' },
      { email: 'gemini@astrid.cc', name: 'Gemini', service: 'gemini', image: '/api/v1/agent-icon/gemini' },
    ])
  })

  it('tolerates whitespace, case and unknown names without throwing', async () => {
    process.env.BRAND_ENABLED_AGENTS = ' Claude , nonsense,, GEMINI '
    const { AI_AGENT_CONFIG } = await import('@/lib/ai/agent-config')

    expect(Object.keys(AI_AGENT_CONFIG).sort()).toEqual([
      'astrid@astrid.cc',
      'claude@astrid.cc',
      'gemini@astrid.cc',
    ])
  })

  it('treats an empty value as unset rather than as "no agents"', async () => {
    process.env.BRAND_ENABLED_AGENTS = '   '
    const { getAllAgentConfigs } = await import('@/lib/ai/agent-config')

    expect(getAllAgentConfigs()).toHaveLength(6)
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
    expect(AI_AGENT_CONFIG['claude@astrid.cc']).toBeUndefined()
    expect(getAgentService('gemini@acme.example')).toBe('gemini')
  })

  it('matches the OpenClaw pattern at the configured domain only', async () => {
    process.env.BRAND_AGENT_EMAIL_DOMAIN = 'acme.example'
    const { isOpenClawAgentEmail, isBrandAgentEmail, openClawAgentEmail } =
      await import('@/lib/brand/agent-emails')

    expect(openClawAgentEmail('buddy')).toBe('buddy.oc@acme.example')
    expect(isOpenClawAgentEmail('buddy.oc@acme.example')).toBe(true)
    expect(isOpenClawAgentEmail('buddy.oc@astrid.cc')).toBe(false)
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
