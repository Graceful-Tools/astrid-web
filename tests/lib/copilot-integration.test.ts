/**
 * GitHub Copilot end-to-end routing (task eed98c5f)
 *
 * A no-token E2E: stubs `fetch` and walks the chain a real copilot@astrid.cc
 * request takes —
 *   email → service (getAgentService)
 *   service → provider caller (dispatchToolCall)
 *   provider call → GitHub's supported Copilot SDK in locked-down empty mode.
 *
 * This locks the supported SDK contract and prevents a regression back to
 * private OpenAI-compatible endpoints or ambient CLI tools.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sdk = vi.hoisted(() => ({
  clientOptions: undefined as Record<string, unknown> | undefined,
  sessionConfig: undefined as Record<string, any> | undefined,
  start: vi.fn(),
  stop: vi.fn(),
  disconnect: vi.fn(),
  sendAndWait: vi.fn(),
}))

vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: class {
    constructor(options: Record<string, unknown>) { sdk.clientOptions = options }
    start = sdk.start
    stop = sdk.stop
    async createSession(config: Record<string, unknown>) {
      sdk.sessionConfig = config
      return { sendAndWait: sdk.sendAndWait, disconnect: sdk.disconnect }
    }
  },
  defineTool: (name: string, config: Record<string, unknown>) => ({ name, ...config }),
  RuntimeConnection: { forUri: (url: string) => ({ kind: 'uri', url }) },
}))

import { callCopilot } from '@/lib/ai/providers/copilot-provider'
import { dispatchToolCall, type ProviderCallers } from '@/lib/astrid-agent/dispatch-ai-service'
import { getAgentService } from '@/lib/ai/agent-config'

const COPILOT_EMAIL = 'copilot@astrid.cc'

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

  describe('provider: supported Copilot SDK', () => {
    beforeEach(() => {
      sdk.clientOptions = undefined
      sdk.sessionConfig = undefined
      sdk.start.mockReset().mockResolvedValue(undefined)
      sdk.stop.mockReset().mockResolvedValue(undefined)
      sdk.disconnect.mockReset().mockResolvedValue(undefined)
      sdk.sendAndWait.mockReset().mockResolvedValue({ data: { content: 'Hello from Copilot' } })
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('uses a per-user token and empty mode with no ambient CLI capabilities', async () => {
      const res = await callCopilot({ apiKey: 'copilot-token-xyz', prompt: 'hi', userId: 'u1' })

      expect(res.content).toBe('Hello from Copilot')
      expect(sdk.clientOptions).toMatchObject({
        mode: 'empty',
        gitHubToken: 'copilot-token-xyz',
        useLoggedInUser: false,
      })
      expect(sdk.sessionConfig).toMatchObject({
        model: 'gpt-4.1',
        gitHubToken: 'copilot-token-xyz',
        skipEmbeddingRetrieval: true,
        availableTools: [],
        skipCustomInstructions: true,
      })
      expect(sdk.sendAndWait).toHaveBeenCalledWith({ prompt: 'hi' }, 60_000)
      expect(sdk.disconnect).toHaveBeenCalledOnce()
      expect(sdk.stop).toHaveBeenCalledOnce()
    })

    it('registers repository tools through SDK handlers', async () => {
      const executed: string[] = []
      await callCopilot({
        apiKey: 'tok',
        prompt: 'read the readme',
        userId: 'u1',
        hasRepository: true,
        executeToolCallback: async (name: string) => {
          executed.push(name)
          return 'file contents'
        },
      })

      expect(sdk.sessionConfig?.availableTools).toEqual([
        'custom:get_repository_file',
        'custom:list_repository_files',
      ])
      const tool = sdk.sessionConfig?.tools[0]
      await tool.handler({ path: 'README.md' })
      expect(executed).toEqual(['get_repository_file'])
    })

    it('rejects an empty SDK response and still cleans up', async () => {
      sdk.sendAndWait.mockResolvedValueOnce(undefined)
      await expect(callCopilot({ apiKey: 'bad', prompt: 'hi', userId: 'u1' })).rejects.toThrow(/empty response/)
      expect(sdk.disconnect).toHaveBeenCalledOnce()
      expect(sdk.stop).toHaveBeenCalledOnce()
    })
  })
})
