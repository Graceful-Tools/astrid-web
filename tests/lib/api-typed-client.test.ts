import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  ApiError,
  apiJson,
  apiV1Resource,
} from '@/lib/api'

describe('typed API client boundaries (task d59a8024)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('validates successful JSON and preserves credentials and AbortSignal', async () => {
    const signal = new AbortController().signal
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ id: 'comment-1', content: 'edited' }),
    )

    const result = await apiJson(
      '/api/v1/comments/comment-1',
      z.object({ id: z.string(), content: z.string() }),
      { signal },
    )

    expect(result).toEqual({ id: 'comment-1', content: 'edited' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/comments/comment-1',
      expect.objectContaining({ credentials: 'include', signal }),
    )
  })

  it('throws a generic ApiError with typed server detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { error: 'Comment not found', code: 'COMMENT_NOT_FOUND' },
        { status: 404, statusText: 'Not Found' },
      ),
    )

    let caught: unknown
    try {
      await apiJson(
        '/api/v1/comments/missing',
        z.object({ id: z.string() }),
        {},
        z.object({ error: z.string(), code: z.literal('COMMENT_NOT_FOUND') }),
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ApiError)
    const apiError = caught as ApiError<{ error: string; code: 'COMMENT_NOT_FOUND' }>
    expect(apiError.status).toBe(404)
    expect(apiError.endpoint).toBe('/api/v1/comments/missing')
    expect(apiError.detail).toEqual({
      error: 'Comment not found',
      code: 'COMMENT_NOT_FOUND',
    })
    expect(apiError.validatedDetail).toEqual(apiError.detail)
  })

  it('standardizes validated v1 and legacy resource envelopes', async () => {
    const commentSchema = z.object({ id: z.string(), content: z.string() })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({
        comment: { id: 'c1', content: 'v1' },
        meta: { apiVersion: 'v1', authSource: 'session' },
      }))
      .mockResolvedValueOnce(Response.json({ id: 'c2', content: 'legacy' }))

    await expect(apiV1Resource('/api/v1/comments/c1', 'comment', commentSchema))
      .resolves.toEqual({
        resource: { id: 'c1', content: 'v1' },
        meta: { apiVersion: 'v1', authSource: 'session' },
      })
    await expect(apiV1Resource('/api/comments/c2', 'comment', commentSchema))
      .resolves.toEqual({
        resource: { id: 'c2', content: 'legacy' },
        meta: null,
      })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
