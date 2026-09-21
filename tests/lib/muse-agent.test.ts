/**
 * Muse as a server-side AI provider, backed by Meta's Llama API.
 *
 * muse@ graduated from the local-harness table (AWTD-937) to a provider-routed
 * agent: in `api` execution mode this server calls the Llama API's
 * OpenAI-compatible endpoint on the user's key; in `polling` mode the Muse
 * Code CLI polls the same identity. These cases pin the registry entries, the
 * provider routing, and the execution-mode rules the graduation depends on.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  SUGGESTED_MODELS,
  DEFAULT_MODELS,
  AI_AGENT_CONFIG,
  getAgentConfig,
  getAgentService,
  getAgentIdentity,
  agentEmailForService,
  isRegisteredAgent,
  getBuiltInAgents,
} from '@/lib/ai/agent-config'
import { isCodingAgentType } from '@/lib/ai-agent-utils'
import {
  resolveAgentExecutionMode,
  isModeLockedToPolling,
  isModeSettableFor,
} from '@/lib/ai/agent-execution-mode'
import {
  callProvider,
  MUSE_BASE_URL,
  MUSE_DEFAULT_MODEL,
  MUSE_REPOSITORY_TOOLS,
} from '@/lib/ai/providers'
import { BRAND } from '@/lib/brand/config'

const MUSE_EMAIL = `muse@${BRAND.agentEmailDomain}`

describe('Muse agent registration', () => {
  it(`registers ${MUSE_EMAIL} in AI_AGENT_CONFIG`, () => {
    expect(AI_AGENT_CONFIG[MUSE_EMAIL]).toBeDefined()
    expect(isRegisteredAgent(MUSE_EMAIL)).toBe(true)
  })

  it(`routes ${MUSE_EMAIL} to the muse service`, () => {
    expect(getAgentService(MUSE_EMAIL)).toBe('muse')
    expect(getAgentConfig(MUSE_EMAIL)?.service).toBe('muse')
  })

  it('maps the muse service back to the muse@ identity', () => {
    expect(agentEmailForService('muse')).toBe(MUSE_EMAIL)
  })

  it('uses the muse_agent agentType and ASTRID.md context file', () => {
    const config = getAgentConfig(MUSE_EMAIL)
    expect(config?.agentType).toBe('muse_agent')
    expect(config?.contextFile).toBe('ASTRID.md')
    expect(config?.displayName).toBe('Muse Agent')
  })

  it('provides suggested and default models for muse', () => {
    expect(SUGGESTED_MODELS.muse?.length).toBeGreaterThan(0)
    expect(DEFAULT_MODELS.muse).toBeTruthy()
    // Default must be one of the suggestions so the picker can preselect it.
    expect(SUGGESTED_MODELS.muse).toContain(DEFAULT_MODELS.muse)
  })

  it('defaults to Llama-4-Maverick on the Llama API', () => {
    expect(DEFAULT_MODELS.muse).toBe('Llama-4-Maverick-17B-128E-Instruct-FP8')
  })

  it('lists Muse among the built-in agents the picker offers', () => {
    const agents = getBuiltInAgents()
    expect(agents.map((a) => a.email)).toContain(MUSE_EMAIL)
    expect(agents.find((a) => a.email === MUSE_EMAIL)?.name).toBe('Muse')
  })

  it('gives muse@ the provider identity for its User row', () => {
    expect(getAgentIdentity(MUSE_EMAIL)).toEqual({
      displayName: 'Muse Agent',
      agentType: 'muse_agent',
    })
  })

  it('counts muse_agent as a coding agent type', () => {
    expect(isCodingAgentType('muse_agent')).toBe(true)
  })
})

describe('Muse execution mode', () => {
  it('is not locked to polling — it has a server executor now', () => {
    expect(isModeLockedToPolling('muse')).toBe(false)
    for (const mode of ['api', 'polling', 'webhook', 'off'] as const) {
      expect(isModeSettableFor('muse', mode), mode).toBe(true)
    }
  })

  it('resolves to api when the user saved a Llama API key', () => {
    expect(
      resolveAgentExecutionMode({ mailbox: 'muse', hasStoredCredential: true })
    ).toBe('api')
  })

  it('resolves to polling without a key, so the Muse Code CLI can run it', () => {
    expect(resolveAgentExecutionMode({ mailbox: 'muse' })).toBe('polling')
  })
})

describe('Muse provider routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls the Llama API compatibility endpoint with Bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'hello from Meta' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await callProvider({
      service: 'muse',
      apiKey: 'LLM|test-key',
      prompt: 'Say hello',
      userId: 'user-1',
    })

    expect(response.content).toBe('hello from Meta')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${MUSE_BASE_URL}/chat/completions`)
    expect(MUSE_BASE_URL).toBe('https://api.llama.com/compat/v1')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer LLM|test-key')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe(MUSE_DEFAULT_MODEL)
  })

  it('exposes the OpenAI-compatible repository tools', () => {
    // getRepositoryTools resolves its modules with require(), which vitest's
    // ESM transform cannot load (pre-existing, affects every provider); assert
    // on the exported constant directly instead.
    expect(MUSE_REPOSITORY_TOOLS.length).toBeGreaterThan(0)
    expect(MUSE_REPOSITORY_TOOLS).toContainEqual(
      expect.objectContaining({ type: 'function' })
    )
  })
})
