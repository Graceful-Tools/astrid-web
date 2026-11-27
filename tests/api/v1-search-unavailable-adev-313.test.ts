/**
 * ADEV-313 (searchParse step B): astrid-core is the only search parser. When it cannot parse —
 * not loaded, threw, sent an error envelope, or answered something that is not a parse —
 * GET /api/v1/search returns a retryable 503, never a guessed parse, and never touches the database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth-wrapper', () => ({
  withAuth: (_opts: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, ctx: unknown) =>
      handler(req, { userId: 'user-1', scopes: ['tasks:read'], source: 'oauth' }, ctx),
}))

const taskFindMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findMany: taskFindMany, count: vi.fn() },
    taskList: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))
vi.mock('@/lib/task-identifier', () => ({ canonicalizeIdentifier: vi.fn().mockResolvedValue(null) }))

import { GET } from '@/app/api/v1/search/route'
import { createSearchQueryCore } from '@/lib/core-rules/search-query-core'
import { setSearchQueryCore } from '@/lib/search-query-parser'
import { installTestSearchCore } from '@/tests/support/install-search-core'

const search = (q: string) =>
  GET(new NextRequest(`http://localhost/api/v1/search?q=${encodeURIComponent(q)}`), {
    params: Promise.resolve({}),
  } as never)

const envelopes: Array<[string, (request: string) => string]> = [
  ['an error envelope', () => JSON.stringify({ ok: false, error: { kind: 'invalid' } })],
  ['something that is not a parse', () => JSON.stringify({ ok: true, value: { text: 5 } })],
  ['a throw', () => {
    throw new Error('wasm trap')
  }],
]

beforeEach(() => {
  vi.clearAllMocks()
  taskFindMany.mockResolvedValue([])
})
afterEach(() => installTestSearchCore())

describe('GET /api/v1/search when astrid-core cannot parse (ADEV-313)', () => {
  it('is 503 and retryable when the core is not loaded', async () => {
    setSearchQueryCore(null)
    const response = await search('priority:high')
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('5')
    expect(await response.json()).toMatchObject({ error: 'Service unavailable', retryable: true })
    expect(taskFindMany).not.toHaveBeenCalled()
  })

  it.each(envelopes)('is 503 for %s', async (_name, runJson) => {
    const parser = createSearchQueryCore(runJson, { failure: () => {} })
    setSearchQueryCore(parser.parse)
    const response = await search('priority:high')
    expect(response.status).toBe(503)
    expect(taskFindMany).not.toHaveBeenCalled()
  })

  it('still answers when the core parses', async () => {
    const response = await search('priority:high')
    expect(response.status).toBe(200)
    expect(taskFindMany).toHaveBeenCalled()
  })
})
