/**
 * RED for task 1a77bcb1.
 *
 * run-assistant-workflow called the Anthropic, OpenAI and Gemini endpoints with
 * a bare fetch: no AbortController, no timeout, no retry — while
 * lib/ai/clients/fetch-with-timeout.ts sat two directories away, unused, with
 * AI_REQUEST_TIMEOUT_MS already defined. A provider that hangs holds the
 * invocation until the platform kills it, and the file's own header documents
 * that the answer is then simply lost.
 *
 * The same applied to the GitHub client, which runs inside a 60s cron that must
 * walk every user's links.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'

describe('provider calls are timed', () => {
  const workflow = fs.readFileSync('lib/assistant-workflow/run-assistant-workflow.ts', 'utf8')

  it.each([
    ['Anthropic', 'https://api.anthropic.com/v1/messages'],
    ['OpenAI', 'https://api.openai.com/v1/chat/completions'],
  ])('calls %s through the timeout wrapper', (_label, url) => {
    expect(workflow).toContain(`fetchWithTimeout('${url}'`)
    expect(workflow).not.toContain(`fetch('${url}'`)
  })

  it('calls Gemini through the timeout wrapper', () => {
    // Gemini's URL is built from the model, so match the call shape instead.
    const geminiSection = workflow.slice(workflow.indexOf("case 'gemini'"))
    expect(geminiSection).toContain('fetchWithTimeout(')
  })

  it('uses the shared budget rather than a new number', () => {
    expect(workflow).toContain('AI_REQUEST_TIMEOUT_MS')
  })
})

describe('the GitHub client is timed', () => {
  const github = fs.readFileSync('lib/sync/github.ts', 'utf8')

  it('does not call the API with a bare fetch', () => {
    expect(github).toContain('fetchWithTimeout(')
    expect(github).not.toMatch(/await fetch\(`\$\{GITHUB_API\}/)
  })

  it('uses a shorter budget than the AI calls, because it runs inside a cron pass', async () => {
    const { AI_REQUEST_TIMEOUT_MS } = await import('@/lib/ai/clients/fetch-with-timeout')
    const match = github.match(/GITHUB_REQUEST_TIMEOUT_MS = ([\d_]+)/)

    expect(match).not.toBeNull()
    expect(Number(match![1].replace(/_/g, ''))).toBeLessThan(AI_REQUEST_TIMEOUT_MS)
  })
})

describe('fetchWithTimeout', () => {
  it('translates an abort into a descriptive provider timeout', async () => {
    const { fetchWithTimeout } = await import('@/lib/ai/clients/fetch-with-timeout')
    const original = globalThis.fetch
    globalThis.fetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })) as typeof fetch

    try {
      await expect(fetchWithTimeout('https://example.test', {}, 5, 'Claude')).rejects.toThrow(
        /Claude API request timed out after 5ms/,
      )
    } finally {
      globalThis.fetch = original
    }
  })
})
