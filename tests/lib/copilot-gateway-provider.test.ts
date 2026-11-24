/**
 * ADEV-245: the server Copilot provider calls the Copilot gateway when
 * COPILOT_GATEWAY_URL and COPILOT_GATEWAY_SECRET are both set, and keeps the
 * REST path (vscode-chat) when either is unset.
 *
 * The gateway contract lives in lib/ai/providers/copilot-gateway-contract.ts
 * (docs/COPILOT_SDK_INTEGRATION_PLAN.md, Phase 2).
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'

const logLines: string[] = []
vi.mock('@/lib/logger', () => {
  const record =
    (level: string) =>
    (...args: unknown[]) => {
      logLines.push(`${level} ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`)
    }
  const fake = {
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    debug: record('debug'),
    child: () => fake,
  }
  return { createLogger: () => fake, default: fake }
})

import { callCopilot, COPILOT_GATEWAY_UNAVAILABLE } from '@/lib/ai/providers/copilot-provider'
import type { GatewayTurnResponse } from '@/lib/ai/providers/copilot-gateway-contract'

const GATEWAY_URL = 'https://copilot-gateway.example.test'
const GATEWAY_SECRET = 'gateway-shared-secret-for-tests'
const USER_TOKEN = 'gho_user_token_that_must_never_be_logged'

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function completion(content: string) {
  return jsonResponse(200, { choices: [{ message: { content, role: 'assistant' } }] })
}

const done = (text: string): GatewayTurnResponse => ({
  status: 'done',
  text,
  usage: { inputTokens: 12, outputTokens: 34 },
})

describe('Copilot provider gateway path (ADEV-245)', () => {
  let fetchSpy: Mock
  let consoleSpies: Mock[]

  beforeEach(() => {
    logLines.length = 0
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}) as unknown as Mock
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  function setGatewayEnv() {
    vi.stubEnv('COPILOT_GATEWAY_URL', GATEWAY_URL)
    vi.stubEnv('COPILOT_GATEWAY_SECRET', GATEWAY_SECRET)
  }

  it('ADEV-245: with the gateway env unset, calls the Copilot REST API as before', async () => {
    vi.stubEnv('COPILOT_GATEWAY_URL', '')
    vi.stubEnv('COPILOT_GATEWAY_SECRET', '')
    fetchSpy.mockResolvedValue(completion('rest answer'))

    const res = await callCopilot({ apiKey: USER_TOKEN, prompt: 'hi', userId: 'u1' })

    expect(res.content).toBe('rest answer')
    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toBe('https://api.githubcopilot.com/chat/completions')
    expect((init.headers as Record<string, string>)['Copilot-Integration-Id']).toBe('vscode-chat')
  })

  it('ADEV-245: with only one gateway variable set, stays on REST', async () => {
    vi.stubEnv('COPILOT_GATEWAY_URL', GATEWAY_URL)
    vi.stubEnv('COPILOT_GATEWAY_SECRET', '')
    fetchSpy.mockResolvedValue(completion('rest answer'))

    await callCopilot({ apiKey: USER_TOKEN, prompt: 'hi', userId: 'u1' })

    expect(String(fetchSpy.mock.calls[0][0])).toBe('https://api.githubcopilot.com/chat/completions')
  })

  it('ADEV-245: with the gateway env set, posts the turn with the bearer secret and no Copilot-Integration-Id', async () => {
    setGatewayEnv()
    fetchSpy.mockResolvedValue(jsonResponse(200, done('gateway answer')))

    const res = await callCopilot({
      apiKey: USER_TOKEN,
      prompt: 'plan this',
      userId: 'u1',
      model: 'gpt-5',
      maxTokens: 2048,
    })

    expect(res).toEqual({ content: 'gateway answer', usage: { inputTokens: 12, outputTokens: 34 } })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toBe(`${GATEWAY_URL}/v1/turns`)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${GATEWAY_SECRET}`)
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('copilot-integration-id')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ githubToken: USER_TOKEN, model: 'gpt-5', prompt: 'plan this', maxTokens: 2048 })
    expect(body.tools).toBeUndefined()
  })

  it('ADEV-245: runs a tool round trip through executeToolCallback and the tool-results endpoint', async () => {
    setGatewayEnv()
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: 'tool_calls',
          turnId: 'turn-1',
          calls: [{ id: 'call-1', name: 'get_repository_file', arguments: { path: 'README.md' } }],
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, done('read it')))
    const executeToolCallback = vi.fn().mockResolvedValue({ content: '# Readme' })

    const res = await callCopilot({
      apiKey: USER_TOKEN,
      prompt: 'read the readme',
      userId: 'u1',
      hasRepository: true,
      executeToolCallback,
    })

    expect(res.content).toBe('read it')
    const first = JSON.parse(fetchSpy.mock.calls[0][1].body as string)
    expect(first.tools.map((t: { name: string }) => t.name)).toEqual(['get_repository_file', 'list_repository_files'])
    expect(first.tools[0].parameters).toMatchObject({ type: 'object' })

    expect(executeToolCallback).toHaveBeenCalledWith('get_repository_file', { path: 'README.md' })
    const [url, init] = fetchSpy.mock.calls[1]
    expect(String(url)).toBe(`${GATEWAY_URL}/v1/turns/turn-1/tool-results`)
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${GATEWAY_SECRET}`)
    expect(JSON.parse(init.body as string)).toEqual({
      results: [{ id: 'call-1', output: JSON.stringify({ content: '# Readme' }) }],
    })
  })

  it('ADEV-245: a failing tool is reported back to the model as an error, not thrown', async () => {
    setGatewayEnv()
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: 'tool_calls',
          turnId: 'turn-2',
          calls: [{ id: 'c1', name: 'list_repository_files', arguments: {} }],
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, done('ok')))

    await callCopilot({
      apiKey: USER_TOKEN,
      prompt: 'x',
      userId: 'u1',
      hasRepository: true,
      executeToolCallback: vi.fn().mockRejectedValue(new Error('no such dir')),
    })

    expect(JSON.parse(fetchSpy.mock.calls[1][1].body as string).results[0]).toEqual({
      id: 'c1',
      output: 'Error: no such dir',
    })
  })

  it('ADEV-245: a gateway 503 fails with "Copilot gateway unavailable" and never falls back to REST', async () => {
    setGatewayEnv()
    fetchSpy.mockResolvedValue(jsonResponse(503, { error: 'busy' }))

    await expect(callCopilot({ apiKey: USER_TOKEN, prompt: 'hi', userId: 'u1' })).rejects.toThrow(
      COPILOT_GATEWAY_UNAVAILABLE
    )
    expect(COPILOT_GATEWAY_UNAVAILABLE).toBe('Copilot gateway unavailable')
    expect(fetchSpy.mock.calls.every(([url]) => String(url).startsWith(GATEWAY_URL))).toBe(true)
  })

  it('ADEV-245: a gateway timeout or network error fails with "Copilot gateway unavailable"', async () => {
    setGatewayEnv()
    fetchSpy.mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }))

    await expect(callCopilot({ apiKey: USER_TOKEN, prompt: 'hi', userId: 'u1' })).rejects.toThrow(
      'Copilot gateway unavailable'
    )
    expect(fetchSpy.mock.calls.every(([url]) => String(url).startsWith(GATEWAY_URL))).toBe(true)
  })

  it('ADEV-245: a gateway 4xx surfaces its status rather than empty content', async () => {
    setGatewayEnv()
    fetchSpy.mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }))

    await expect(callCopilot({ apiKey: USER_TOKEN, prompt: 'hi', userId: 'u1' })).rejects.toThrow(/401/)
  })

  it('ADEV-245: stops after the same 30-turn cap as the OpenAI path', async () => {
    setGatewayEnv()
    fetchSpy.mockImplementation(async () =>
      jsonResponse(200, {
        status: 'tool_calls',
        turnId: 'loop',
        calls: [{ id: 'c', name: 'list_repository_files', arguments: {} }],
      })
    )

    await expect(
      callCopilot({
        apiKey: USER_TOKEN,
        prompt: 'x',
        userId: 'u1',
        hasRepository: true,
        executeToolCallback: async () => 'files',
      })
    ).rejects.toThrow(/max iterations/i)
    expect(fetchSpy).toHaveBeenCalledTimes(30)
  })

  it('ADEV-245: the user token and gateway secret never reach a log line', async () => {
    setGatewayEnv()
    const logger = vi.fn()
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: 'tool_calls',
          turnId: 't',
          calls: [{ id: 'c', name: 'get_repository_file', arguments: { path: 'a' } }],
        })
      )
      .mockResolvedValueOnce(jsonResponse(503, { error: 'down' }))

    await expect(
      callCopilot({
        apiKey: USER_TOKEN,
        prompt: 'x',
        userId: 'u1',
        logger,
        hasRepository: true,
        executeToolCallback: async () => 'a',
      })
    ).rejects.toThrow('Copilot gateway unavailable')

    const everything = [
      ...logLines,
      ...logger.mock.calls.map((c) => JSON.stringify(c)),
      ...consoleSpies.flatMap((s) => s.mock.calls.map((c) => JSON.stringify(c))),
    ].join('\n')
    expect(logger).toHaveBeenCalled()
    expect(everything).not.toContain(USER_TOKEN)
    expect(everything).not.toContain(GATEWAY_SECRET)
  })
})
