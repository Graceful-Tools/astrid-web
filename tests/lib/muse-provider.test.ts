/**
 * Muse (Meta) as a provider that can power the assistant (AWTD-1053)
 *
 * Until now Muse existed only as Muse Code, a CLI that polls the `muse@` queue,
 * and the server had no executor for it — so the assistant picker (which lists
 * server-run agents only) had nothing to offer iOS (AITD-449).
 *
 * Meta's Model API (launched 2026-07-09) serves the Muse Spark models over an
 * OpenAI-compatible REST surface at https://api.meta.ai/v1, authenticated with a
 * Bearer key from the Meta Developer Console. So `muse@` becomes what `claude@`
 * already is: one identity, two runtimes — the user's Muse Code loop when it is
 * polling, this server on the user's Meta key when it is in API mode.
 *
 * A no-key E2E: stubs `fetch` and walks the chain a real muse@ request takes.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'

import { callMuse, MUSE_BASE_URL } from '@/lib/ai/providers/muse-provider'
import { callProvider } from '@/lib/ai/providers'
import { dispatchToolCall, type ProviderCallers } from '@/lib/astrid-agent/dispatch-ai-service'
import {
  DEFAULT_MODELS,
  SUGGESTED_MODELS,
  agentEmailForService,
  getAgentService,
  getBuiltInAgents,
} from '@/lib/ai/agent-config'
import {
  isModeLockedToPolling,
  isModeSettableFor,
  resolveAgentExecutionMode,
} from '@/lib/ai/agent-execution-mode'
import { fetchProviderModels } from '@/lib/ai/fetch-provider-models'
import { BRAND } from '@/lib/brand/config'

const MUSE_EMAIL = `muse@${BRAND.agentEmailDomain}`

function completion(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content, role: 'assistant' } }] }),
    text: async () => '',
  }
}

describe('Muse as an assistant provider (AWTD-1053)', () => {
  describe('routing', () => {
    it(`resolves ${MUSE_EMAIL} to the muse service`, () => {
      expect(getAgentService(MUSE_EMAIL)).toBe('muse')
      expect(agentEmailForService('muse')).toBe(MUSE_EMAIL)
    })

    it('is offered as a built-in agent, so the assistant picker can list it', () => {
      const muse = getBuiltInAgents().find((agent) => agent.service === 'muse')
      expect(muse).toMatchObject({ email: MUSE_EMAIL, name: 'Muse' })
    })

    it('suggests and defaults to a Muse Spark model', () => {
      expect(DEFAULT_MODELS.muse).toBe('muse-spark-1.3')
      expect(SUGGESTED_MODELS.muse).toContain('muse-spark-1.3')
    })

    it('dispatch routes the muse service to the muse caller and nothing else', async () => {
      const ran: string[] = []
      const spy = (label: string) => async () => {
        ran.push(label)
        return `${label}-response`
      }
      const callers: ProviderCallers = {
        claude: spy('claude'),
        openai: spy('openai'),
        gemini: spy('gemini'),
        copilot: spy('copilot'),
        muse: spy('muse'),
      }

      const out = await dispatchToolCall({
        service: 'muse',
        apiKey: 'k',
        systemPrompt: 'sys',
        userMessage: 'hi',
        toolContext: { userId: 'u1' },
        callers,
      })

      expect(ran).toEqual(['muse'])
      expect(out).toBe('muse-response')
    })
  })

  describe('execution mode: one identity, two runtimes (like claude@)', () => {
    it('is no longer locked to polling — a Meta key makes API mode possible', () => {
      expect(isModeLockedToPolling('muse')).toBe(false)
      expect(isModeSettableFor('muse', 'api')).toBe(true)
    })

    it('defaults to polling without a key, so Muse Code users see no change', () => {
      expect(resolveAgentExecutionMode({ mailbox: 'muse' })).toBe('polling')
    })

    it('defaults to api once a Meta key is saved', () => {
      expect(resolveAgentExecutionMode({ mailbox: 'muse', hasStoredCredential: true })).toBe('api')
    })

    it('keeps Codex harness-only: it still has no server executor', () => {
      expect(isModeLockedToPolling('codex')).toBe(true)
    })
  })

  describe('provider: Meta Model API', () => {
    let fetchSpy: Mock

    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue(completion('Hello from Muse'))
      vi.stubGlobal('fetch', fetchSpy)
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('calls the Meta chat-completions endpoint with the user key as a Bearer token', async () => {
      const res = await callMuse({ apiKey: 'meta-key-xyz', prompt: 'hi', userId: 'u1' })

      expect(res.content).toBe('Hello from Muse')
      const [url, init] = fetchSpy.mock.calls[0]
      expect(MUSE_BASE_URL).toBe('https://api.meta.ai/v1')
      expect(String(url)).toBe('https://api.meta.ai/v1/chat/completions')
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer meta-key-xyz')
    })

    it('defaults to the current Muse Spark model', async () => {
      await callMuse({ apiKey: 'k', prompt: 'hi', userId: 'u1' })
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string)
      expect(body.model).toBe('muse-spark-1.3')
    })

    it('is reachable through the unified callProvider switch', async () => {
      const res = await callProvider({ service: 'muse', apiKey: 'k', prompt: 'hi', userId: 'u1' })
      expect(res.content).toBe('Hello from Muse')
      expect(String(fetchSpy.mock.calls[0][0])).toBe('https://api.meta.ai/v1/chat/completions')
    })

    it('lists only Muse models from GET /models', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: 'muse-spark-1.1' }, { id: 'muse-voice-transcribe' }, { id: 'muse-spark-1.3' }],
        }),
        text: async () => '',
      })

      const models = await fetchProviderModels('muse', 'meta-models-key')

      expect(String(fetchSpy.mock.calls[0][0])).toBe('https://api.meta.ai/v1/models')
      expect(models).toEqual(['muse-spark-1.3', 'muse-spark-1.1'])
    })
  })
})
