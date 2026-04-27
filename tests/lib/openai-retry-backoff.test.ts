import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { callOpenAI, computeRetryDelayMs } from '@/lib/ai/clients/openai'

const ORIGINAL_FETCH = global.fetch

function mockResponse(init: { status: number; body?: any; headers?: Record<string, string> }): Response {
  return new Response(typeof init.body === 'string' ? init.body : JSON.stringify(init.body ?? ''), {
    status: init.status,
    headers: init.headers,
  })
}

const successBody = {
  choices: [{ message: { content: 'ok' } }],
  model: 'gpt-4o',
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
}

beforeEach(() => {
  global.fetch = vi.fn() as any
})

afterEach(() => {
  global.fetch = ORIGINAL_FETCH
})

describe('computeRetryDelayMs', () => {
  it('honors numeric Retry-After (seconds)', () => {
    expect(computeRetryDelayMs(1, '5')).toBe(5_000)
  })

  it('caps Retry-After at 30s', () => {
    expect(computeRetryDelayMs(1, '600')).toBe(30_000)
  })

  it('falls back to jittered exponential when no header', () => {
    const delay = computeRetryDelayMs(2, null)
    expect(delay).toBeGreaterThanOrEqual(0)
    expect(delay).toBeLessThanOrEqual(2_000)
  })
})

describe('callOpenAI retry behavior', () => {
  it('returns immediately on success', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(mockResponse({ status: 200, body: successBody }))
    const sleepFn = vi.fn()
    const result = await callOpenAI({ apiKey: 'k', prompt: 'p', sleepFn })
    expect(result.content).toBe('ok')
    expect(sleepFn).not.toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('retries on 429 and succeeds on second attempt', async () => {
    ;(global.fetch as any)
      .mockResolvedValueOnce(mockResponse({ status: 429, body: 'rate limited' }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: successBody }))
    const sleepFn = vi.fn()
    const result = await callOpenAI({ apiKey: 'k', prompt: 'p', sleepFn })
    expect(result.content).toBe('ok')
    expect(sleepFn).toHaveBeenCalledTimes(1)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('retries on 503 (transient server error)', async () => {
    ;(global.fetch as any)
      .mockResolvedValueOnce(mockResponse({ status: 503, body: 'unavailable' }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: successBody }))
    const sleepFn = vi.fn()
    const result = await callOpenAI({ apiKey: 'k', prompt: 'p', sleepFn })
    expect(result.content).toBe('ok')
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry on 4xx other than 429', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(mockResponse({ status: 401, body: 'bad key' }))
    const sleepFn = vi.fn()
    await expect(callOpenAI({ apiKey: 'k', prompt: 'p', sleepFn })).rejects.toThrow(/401/)
    expect(sleepFn).not.toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('honors Retry-After header on 429', async () => {
    ;(global.fetch as any)
      .mockResolvedValueOnce(
        mockResponse({ status: 429, body: 'limit', headers: { 'retry-after': '7' } })
      )
      .mockResolvedValueOnce(mockResponse({ status: 200, body: successBody }))
    const sleepFn = vi.fn()
    await callOpenAI({ apiKey: 'k', prompt: 'p', sleepFn })
    expect(sleepFn).toHaveBeenCalledWith(7_000)
  })

  it('throws after exhausting retries on persistent 429', async () => {
    ;(global.fetch as any)
      .mockResolvedValue(mockResponse({ status: 429, body: 'still limited' }))
    const sleepFn = vi.fn()
    await expect(
      callOpenAI({ apiKey: 'k', prompt: 'p', maxRetries: 2, sleepFn })
    ).rejects.toThrow(/429/)
    // 1 initial + 2 retries = 3 attempts; sleeps between them = 2 sleeps
    expect(global.fetch).toHaveBeenCalledTimes(3)
    expect(sleepFn).toHaveBeenCalledTimes(2)
  })

  it('does not retry when maxRetries=0', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(mockResponse({ status: 429, body: 'limit' }))
    const sleepFn = vi.fn()
    await expect(
      callOpenAI({ apiKey: 'k', prompt: 'p', maxRetries: 0, sleepFn })
    ).rejects.toThrow(/429/)
    expect(sleepFn).not.toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})
