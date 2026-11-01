/**
 * AWTD-1467: every AI client reaches the provider at the configured base URL,
 * and OpenAI uses Azure's header shape when the URL is Azure. Unset, every
 * request goes exactly where it always did.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/workflow-queue', () => ({
  workflowQueue: { getTokensUsedInWindow: () => 0, recordTokens: () => undefined },
}))

import { callOpenAI } from '@/lib/ai/clients/openai'
import { callClaude } from '@/lib/ai/clients/claude'
import { callGemini } from '@/lib/ai/clients/gemini'
import { resetProviderEndpointsForTests } from '@/lib/ai/config/provider-endpoints'

const VARS = ['OPENAI_BASE_URL', 'OPENAI_API_VERSION', 'ANTHROPIC_BASE_URL', 'GEMINI_BASE_URL'] as const
const ORIGINAL_FETCH = global.fetch
const saved: Record<string, string | undefined> = {}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const openAIBody = { choices: [{ message: { content: 'ok' } }], model: 'gpt-4o' }
const claudeText = { content: [{ type: 'text', text: 'ok' }] }
const geminiBody = { candidates: [{ content: { parts: [{ text: 'ok' }] } }] }

let fetchMock: ReturnType<typeof vi.fn>
const call = (i = 0) => ({ url: fetchMock.mock.calls[i][0] as string, init: fetchMock.mock.calls[i][1] as RequestInit })
const headers = (i = 0) => call(i).init.headers as Record<string, string>

beforeEach(() => {
  for (const v of VARS) { saved[v] = process.env[v]; delete process.env[v] }
  resetProviderEndpointsForTests()
  fetchMock = vi.fn()
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  for (const v of VARS) { if (saved[v] === undefined) delete process.env[v]; else process.env[v] = saved[v] }
  resetProviderEndpointsForTests()
  global.fetch = ORIGINAL_FETCH
})

describe('AWTD-1467: OpenAI base URL', () => {
  it('defaults to api.openai.com with a bearer token', async () => {
    fetchMock.mockResolvedValueOnce(json(openAIBody))
    await callOpenAI({ apiKey: 'k', prompt: 'p', maxRetries: 0 })
    expect(call().url).toBe('https://api.openai.com/v1/chat/completions')
    expect(headers().Authorization).toBe('Bearer k')
    expect(headers()['api-key']).toBeUndefined()
  })

  it('uses OPENAI_BASE_URL for an OpenAI-compatible host', async () => {
    process.env.OPENAI_BASE_URL = 'https://llm.example.com/v1/'
    fetchMock.mockResolvedValueOnce(json(openAIBody))
    await callOpenAI({ apiKey: 'k', prompt: 'p', maxRetries: 0 })
    expect(call().url).toBe('https://llm.example.com/v1/chat/completions')
    expect(headers().Authorization).toBe('Bearer k')
  })

  it('sends the Azure api-key header and api-version on *.openai.azure.com', async () => {
    process.env.OPENAI_BASE_URL = 'https://acme.openai.azure.com/openai/deployments/gpt-4o'
    process.env.OPENAI_API_VERSION = '2024-10-21'
    fetchMock.mockResolvedValueOnce(json(openAIBody))
    await callOpenAI({ apiKey: 'azure-key', prompt: 'p', maxRetries: 0 })
    expect(call().url).toBe(
      'https://acme.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21'
    )
    expect(headers()['api-key']).toBe('azure-key')
    expect(headers().Authorization).toBeUndefined()
  })
})

describe('AWTD-1467: Anthropic base URL', () => {
  const opts = { apiKey: 'k', prompt: 'p', userId: 'u', jsonOnly: true, logger: () => undefined }

  it('defaults to api.anthropic.com', async () => {
    fetchMock.mockResolvedValueOnce(json(claudeText))
    await callClaude(opts)
    expect(call().url).toBe('https://api.anthropic.com/v1/messages')
    expect(headers()['x-api-key']).toBe('k')
  })

  it('uses ANTHROPIC_BASE_URL for both the loop and the final request', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://acme.services.ai.azure.com/anthropic/'
    fetchMock
      .mockResolvedValueOnce(json({ content: [{ type: 'tool_use', id: 't1', name: 'read', input: {} }] }))
      .mockResolvedValueOnce(json(claudeText))
    await callClaude({ ...opts, executeToolCallback: async () => ({}) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(call(0).url).toBe('https://acme.services.ai.azure.com/anthropic/v1/messages')
    expect(call(1).url).toBe('https://acme.services.ai.azure.com/anthropic/v1/messages')
  })
})

describe('AWTD-1467: Gemini base URL', () => {
  it('defaults to generativelanguage.googleapis.com', async () => {
    fetchMock.mockResolvedValueOnce(json(geminiBody))
    await callGemini({ apiKey: 'k', prompt: 'p' })
    expect(call().url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=k'
    )
  })

  it('uses GEMINI_BASE_URL', async () => {
    process.env.GEMINI_BASE_URL = 'https://gemini-proxy.example.com'
    fetchMock.mockResolvedValueOnce(json(geminiBody))
    await callGemini({ apiKey: 'k', prompt: 'p' })
    expect(call().url).toBe(
      'https://gemini-proxy.example.com/v1beta/models/gemini-2.5-flash:generateContent?key=k'
    )
  })
})
