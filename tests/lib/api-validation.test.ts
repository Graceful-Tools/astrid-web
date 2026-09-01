import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  parseJsonBody,
  parseQueryParams,
  parseRouteParams,
} from '@/lib/api-validation'

describe('shared API edge validation (task d59a8024)', () => {
  it('returns a typed success result for JSON bodies', async () => {
    const request = new NextRequest('http://localhost/api/v1/comments/c1', {
      method: 'PUT',
      body: JSON.stringify({ content: 'edited' }),
      headers: { 'content-type': 'application/json' },
    })

    const result = await parseJsonBody(
      request,
      z.object({ content: z.string().min(1) }),
    )

    expect(result).toEqual({ ok: true, data: { content: 'edited' } })
  })

  it('turns malformed JSON into the standard v1 error shape', async () => {
    const request = new NextRequest('http://localhost/api/v1/comments/c1', {
      method: 'PUT',
      body: '{not-json',
      headers: { 'content-type': 'application/json' },
    })

    const result = await parseJsonBody(request, z.object({ content: z.string() }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(400)
      await expect(result.response.json()).resolves.toEqual({ error: 'Invalid JSON body' })
    }
  })

  it('validates async route params without casting them', async () => {
    const result = await parseRouteParams(
      Promise.resolve({ id: 'comment-1' }),
      z.object({ id: z.string().min(1) }),
    )

    expect(result).toEqual({ ok: true, data: { id: 'comment-1' } })
  })

  it('normalizes URLSearchParams before applying a query schema', () => {
    const query = new URLSearchParams('limit=25&tag=one&tag=two')
    const result = parseQueryParams(
      query,
      z.object({
        limit: z.coerce.number().int().positive(),
        tag: z.array(z.string()),
      }),
    )

    expect(result).toEqual({ ok: true, data: { limit: 25, tag: ['one', 'two'] } })
  })
})
