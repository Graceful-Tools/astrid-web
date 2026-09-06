/**
 * RED for task 979e1325 — the SDK carried a stale fork of the server's agent
 * routing table and three different answers to "which server am I talking to".
 *
 *   - AI_AGENT_CONFIG hardcoded claude@astrid.cc and friends, so pointing the
 *     SDK at a partner deployment still produced Astrid addresses.
 *   - DEFAULT_MODELS.openai said 'o4-mini'; lib/ai/agent-config.ts, which is
 *     authoritative, says 'gpt-4o'. There was no copilot entry at all.
 *   - rest-client, sse-client and oauth-client defaulted to
 *     https://www.astrid.cc/api/v1 while adapters/astrid-oauth.ts defaulted to
 *     https://astrid.cc — a different HOST, not just a different brand.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  delete process.env.ASTRID_API_URL
  delete process.env.ASTRID_API_BASE_URL
  delete process.env.ASTRID_AGENT_EMAIL_DOMAIN
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.resetModules()
})

describe('SDK base URL resolution (task 979e1325)', () => {
  it('gives the same host to the origin and the versioned API base', async () => {
    const { resolveOrigin, resolveApiBase } =
      await import('../../packages/astrid-sdk/src/config/api-base')

    expect(resolveApiBase()).toBe(`${resolveOrigin()}/api/v1`)
  })

  it('follows ASTRID_API_URL for both', async () => {
    process.env.ASTRID_API_URL = 'https://tasks.acme.example'
    const { resolveOrigin, resolveApiBase } =
      await import('../../packages/astrid-sdk/src/config/api-base')

    expect(resolveOrigin()).toBe('https://tasks.acme.example')
    expect(resolveApiBase()).toBe('https://tasks.acme.example/api/v1')
  })

  it('strips a trailing slash so concatenated paths do not double up', async () => {
    process.env.ASTRID_API_URL = 'https://tasks.acme.example/'
    const { resolveApiBase } = await import('../../packages/astrid-sdk/src/config/api-base')

    expect(resolveApiBase()).toBe('https://tasks.acme.example/api/v1')
  })

  it('lets an explicit value win over the environment', async () => {
    process.env.ASTRID_API_URL = 'https://tasks.acme.example'
    const { resolveApiBase } = await import('../../packages/astrid-sdk/src/config/api-base')

    expect(resolveApiBase('https://other.example/api/v1')).toBe('https://other.example/api/v1')
  })
})

describe('SDK agent identities (task 979e1325)', () => {
  it('builds agent addresses on the configured deployment, not astrid.cc', async () => {
    process.env.ASTRID_API_URL = 'https://tasks.acme.example'
    const { AI_AGENT_CONFIG, agentEmailDomain } =
      await import('../../packages/astrid-sdk/src/utils/agent-config')

    expect(agentEmailDomain()).toBe('tasks.acme.example')
    expect(Object.keys(AI_AGENT_CONFIG)).toContain('claude@tasks.acme.example')
    for (const email of Object.keys(AI_AGENT_CONFIG)) {
      expect(email, `${email} still points at astrid.cc`).not.toContain('astrid.cc')
    }
  })

  it('agrees with the server about the default OpenAI model', async () => {
    const { DEFAULT_MODELS } =
      await import('../../packages/astrid-sdk/src/utils/agent-config')
    const { getAgentModel } = await import('@/lib/ai/agent-config')
    const { BRAND } = await import('@/lib/brand/config')

    expect(DEFAULT_MODELS.openai).toBe(getAgentModel(`openai@${BRAND.agentEmailDomain}`))
  })

  it('knows about the copilot agent the server has', async () => {
    const { DEFAULT_MODELS, AI_AGENT_CONFIG, agentEmailDomain } =
      await import('../../packages/astrid-sdk/src/utils/agent-config')

    expect(DEFAULT_MODELS.copilot).toBeTruthy()
    expect(Object.keys(AI_AGENT_CONFIG)).toContain(`copilot@${agentEmailDomain()}`)
  })

  it('asks the server which agents actually exist', async () => {
    const { fetchAgentConfig } =
      await import('../../packages/astrid-sdk/src/utils/agent-config')

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        agents: [{ email: 'claude@tasks.acme.example', service: 'claude', model: 'claude-sonnet-4-6' }],
      }),
    })) as unknown as typeof fetch

    const agents = await fetchAgentConfig({
      token: 'tok',
      apiBase: 'https://tasks.acme.example/api/v1',
      fetchImpl,
    })

    expect(agents).toHaveLength(1)
    expect(agents![0].email).toBe('claude@tasks.acme.example')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://tasks.acme.example/api/v1/users/me/available-agents',
      expect.objectContaining({ headers: expect.objectContaining({ 'X-OAuth-Token': 'tok' }) })
    )
  })

  it('falls back rather than throwing when the server is unreachable', async () => {
    const { fetchAgentConfig } =
      await import('../../packages/astrid-sdk/src/utils/agent-config')

    const fetchImpl = vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch

    expect(await fetchAgentConfig({ token: 'tok', fetchImpl })).toBeNull()
  })
})
