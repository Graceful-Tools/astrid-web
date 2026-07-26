/**
 * @vitest-environment node
 *
 * Copilot was shipped as a first-class agent but could not actually be used.
 * Probing the live API with a plain `gh auth token` established that Copilot
 * entitlement follows the user's Copilot subscription, not an OAuth app:
 *
 *   GET  api.githubcopilot.com/models            -> 200 (44 models)
 *   POST api.githubcopilot.com/chat/completions  -> 200 (real completion)
 *
 * These pin the three things that were wrong as a result.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import liveModels from '../fixtures/copilot-models.json'

const findUnique = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: { copilotCredential: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}))

// Vault lookup used for the pasted-token fallback.
const getCachedApiKey = vi.fn()
vi.mock('@/lib/api-key-cache', () => ({
  getCachedApiKey: (...a: unknown[]) => getCachedApiKey(...a),
}))

vi.mock('@/lib/field-encryption', () => ({
  encryptField: (v: string) => `enc:${v}`,
  decryptField: (v: string) => v.replace(/^enc:/, ''),
  decryptFieldStrict: (v: string) => v.replace(/^enc:/, ''),
}))

import { SUGGESTED_MODELS, DEFAULT_MODELS } from '@/lib/ai/agent-config'
import { copilotTokenFor, hasCopilotCredential } from '@/lib/copilot/oauth'
import { fetchProviderModels } from '@/lib/ai/fetch-provider-models'

beforeEach(() => {
  findUnique.mockReset()
  getCachedApiKey.mockReset()
  getCachedApiKey.mockResolvedValue(null)
})

/**
 * Bug 1: SUGGESTED_MODELS.copilot offered "gpt-5", which is not a real Copilot
 * model id — the live list has gpt-5-mini / gpt-5.4 / gpt-5.5 / gpt-5.6-*, but
 * no bare gpt-5. Selecting it failed at inference time.
 */
describe('Copilot model ids match what the API actually serves', () => {
  const live = new Set(liveModels.ids)

  it('suggests only models present in the live model list', () => {
    for (const model of SUGGESTED_MODELS.copilot ?? []) {
      expect(live.has(model), `"${model}" is not a real Copilot model id`).toBe(true)
    }
  })

  it('defaults to a model that exists and is suggested', () => {
    const dflt = DEFAULT_MODELS.copilot!
    expect(live.has(dflt), `default "${dflt}" is not a real Copilot model id`).toBe(true)
    expect(SUGGESTED_MODELS.copilot).toContain(dflt)
  })
})

/**
 * Bug 2: Copilot could only be authenticated through the OAuth flow, which is
 * dead until a GitHub OAuth App is registered. A GitHub token works on its own,
 * so a pasted token must be accepted as a fallback — and must also satisfy the
 * gating check, or Copilot authenticates but never appears in the picker.
 */
describe('Copilot accepts a pasted GitHub token as well as OAuth', () => {
  it('prefers the OAuth credential when one exists', async () => {
    findUnique.mockResolvedValue({ accessToken: 'enc:oauth-token', revokedAt: null, expiresAt: null })
    getCachedApiKey.mockResolvedValue('pasted-token')

    expect(await copilotTokenFor('user-1')).toBe('oauth-token')
  })

  it('falls back to a vault-stored token when there is no OAuth credential', async () => {
    findUnique.mockResolvedValue(null)
    getCachedApiKey.mockResolvedValue('pasted-token')

    expect(await copilotTokenFor('user-1')).toBe('pasted-token')
  })

  it('reports the user as credentialed when only a pasted token exists', async () => {
    findUnique.mockResolvedValue(null)
    getCachedApiKey.mockResolvedValue('pasted-token')

    // Gates the agent picker (orchestrator/factory + both github/status routes).
    expect(await hasCopilotCredential('user-1')).toBe(true)
  })

  it('reports no credential when neither source has one', async () => {
    findUnique.mockResolvedValue(null)
    getCachedApiKey.mockResolvedValue(null)

    expect(await hasCopilotCredential('user-1')).toBe(false)
    expect(await copilotTokenFor('user-1')).toBeNull()
  })

  it('ignores a revoked OAuth credential but still honours a pasted token', async () => {
    findUnique.mockResolvedValue({ accessToken: 'enc:oauth-token', revokedAt: new Date(), expiresAt: null })
    getCachedApiKey.mockResolvedValue('pasted-token')

    expect(await copilotTokenFor('user-1')).toBe('pasted-token')
  })
})

/**
 * Bug 3: fetchProviderModels('copilot') was stubbed to [] with the comment that
 * enumeration "would start a CLI runtime during a settings-page request". It is
 * a plain GET with the Copilot integration headers.
 */
describe('Copilot live model enumeration', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })

  it('returns ids from the models endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'gpt-4.1' }, { id: 'claude-sonnet-5' }] }),
    }) as never

    const models = await fetchProviderModels('copilot', 'gho_token')

    expect(models).toContain('gpt-4.1')
    expect(models).toContain('claude-sonnet-5')
  })

  it('sends the Copilot integration headers', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) })
    globalThis.fetch = spy as never

    // Distinct token per case — results are memoised per (service, key), so
    // reusing a token would serve the previous test's cached list and never fetch.
    await fetchProviderModels('copilot', 'gho_headers_probe')

    const [url, init] = spy.mock.calls[0]
    expect(String(url)).toContain('api.githubcopilot.com')
    expect((init.headers as Record<string, string>)['Copilot-Integration-Id']).toBeTruthy()
  })

  it('falls back to an empty list when the API rejects the token', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }) as never

    expect(await fetchProviderModels('copilot', 'gho_rejected_probe')).toEqual([])
  })
})
