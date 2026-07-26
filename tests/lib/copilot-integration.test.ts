/**
 * GitHub Copilot end-to-end routing (task eed98c5f)
 *
 * A no-token E2E: stubs `fetch` and walks the chain a real copilot@astrid.cc
 * request takes —
 *   email → service (getAgentService)
 *   service → provider caller (dispatchToolCall)
 *   provider call → Copilot's OpenAI-compatible REST API.
 *
 * This previously locked the provider to @github/copilot-sdk and explicitly
 * forbade "regression back to private OpenAI-compatible endpoints". That was
 * reversed deliberately, on evidence:
 *
 *   - The SDK spawns a platform CLI binary. That binary (@github/copilot-<plat>)
 *     is ~253 MB on its own — larger than Vercel's 250 MB unzipped serverless
 *     function limit — and was traced into zero functions, so it could never
 *     have run in production.
 *   - api.githubcopilot.com is not a private endpoint. A live probe with an
 *     ordinary `gh auth token` returned 200 from both GET /models and
 *     POST /chat/completions, with usage accounting.
 *
 * So this now locks the REST contract instead: the Copilot base URL, the
 * integration headers Copilot requires, and per-user token auth.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { callCopilot } from '@/lib/ai/providers/copilot-provider'
import { dispatchToolCall, type ProviderCallers } from '@/lib/astrid-agent/dispatch-ai-service'
import { getAgentService } from '@/lib/ai/agent-config'

const COPILOT_EMAIL = 'copilot@astrid.cc'

/** Minimal OpenAI-compatible completion body. */
function completion(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content, role: 'assistant' } }] }),
    text: async () => '',
  }
}

describe('GitHub Copilot end-to-end routing (task eed98c5f)', () => {
  it('entry: resolves copilot@astrid.cc to the copilot service', () => {
    expect(getAgentService(COPILOT_EMAIL)).toBe('copilot')
  })

  it('dispatch: routes the copilot service to the copilot caller (no other caller runs)', async () => {
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
    }

    const out = await dispatchToolCall({
      service: 'copilot',
      apiKey: 'tok',
      systemPrompt: 'sys',
      userMessage: 'hi',
      toolContext: { userId: 'u1' },
      callers,
    })

    expect(ran).toEqual(['copilot'])
    expect(out).toBe('copilot-response')
  })

  describe('provider: Copilot REST API', () => {
    let fetchSpy: ReturnType<typeof vi.fn>

    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue(completion('Hello from Copilot'))
      vi.stubGlobal('fetch', fetchSpy)
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('calls the Copilot chat endpoint with a per-user token', async () => {
      const res = await callCopilot({ apiKey: 'copilot-token-xyz', prompt: 'hi', userId: 'u1' })

      expect(res.content).toBe('Hello from Copilot')

      const [url, init] = fetchSpy.mock.calls[0]
      expect(String(url)).toBe('https://api.githubcopilot.com/chat/completions')
      const headers = init.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer copilot-token-xyz')
    })

    it('sends the integration headers Copilot requires', async () => {
      await callCopilot({ apiKey: 'tok', prompt: 'hi', userId: 'u1' })

      const headers = fetchSpy.mock.calls[0][1].headers as Record<string, string>
      // Copilot rejects requests without an integration id.
      expect(headers['Copilot-Integration-Id']).toBe('vscode-chat')
      expect(headers['Editor-Version']).toBe('Astrid/1.0')
    })

    it('defaults to a model Copilot actually serves', async () => {
      await callCopilot({ apiKey: 'tok', prompt: 'hi', userId: 'u1' })

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string)
      expect(body.model).toBe('gpt-4.1')
    })

    it('offers repository tools when the task has a repository', async () => {
      await callCopilot({
        apiKey: 'tok',
        prompt: 'read the readme',
        userId: 'u1',
        hasRepository: true,
        executeToolCallback: async () => 'file contents',
      })

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string)
      const toolNames = (body.tools ?? []).map((t: { function: { name: string } }) => t.function.name)
      expect(toolNames).toContain('get_repository_file')
      expect(toolNames).toContain('list_repository_files')
    })

    it('surfaces an API error rather than returning empty content', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'bad credentials',
      })

      await expect(callCopilot({ apiKey: 'bad', prompt: 'hi', userId: 'u1' })).rejects.toThrow(/401/)
    })
  })
})
