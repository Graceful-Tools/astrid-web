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
 *
 * AWTD-1691 deleted the SDK's agent registry (AI_AGENT_CONFIG and friends) along
 * with the rest of the agent-building library, so only the base URL half remains.
 * The OpenClaw channel keeps its own copy of api-base.ts, checked below too.
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

describe('OpenClaw channel base URL resolution (AWTD-1691 moved the channel)', () => {
  it('agrees with the SDK about the host', async () => {
    process.env.ASTRID_API_URL = 'https://tasks.acme.example'
    const sdk = await import('../../packages/astrid-sdk/src/config/api-base')
    const channel = await import('../../packages/openclaw-astrid-channel/src/astrid/api-base')

    expect(channel.resolveApiBase()).toBe(sdk.resolveApiBase())
    expect(channel.resolveOrigin()).toBe(sdk.resolveOrigin())
  })
})
