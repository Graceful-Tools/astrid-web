import { describe, it, expect, vi } from 'vitest'
import {
  uploadCommentFile,
  COMMENT_FILE_SIZE_LIMIT_BYTES,
} from '@/lib/comment-file-upload'

const taskId = 'task-1'

const makeFile = (sizeBytes: number, name = 'test.png', type = 'image/png'): File => {
  const file = new File([new Uint8Array(0)], name, { type })
  Object.defineProperty(file, 'size', { value: sizeBytes })
  return file
}

const okResponse = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
  }) as Response

const errResponse = (status: number, body: unknown = {}) =>
  ({
    ok: false,
    status,
    json: async () => body,
  }) as Response

describe('uploadCommentFile', () => {
  it('rejects files over 100MB without hitting the network', async () => {
    const oversize = makeFile(COMMENT_FILE_SIZE_LIMIT_BYTES + 1)
    const fetchMock = vi.fn()

    const result = await uploadCommentFile(oversize, taskId, fetchMock as unknown as typeof fetch)

    expect(result.success).toBe(false)
    expect(result.success === false && result.error).toMatch(/100MB/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the canonical attachment shape on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        fileId: 'abc-123',
        fileName: 'test.png',
        mimeType: 'image/png',
        fileSize: 1234,
      }),
    )

    const result = await uploadCommentFile(
      makeFile(1234),
      taskId,
      fetchMock as unknown as typeof fetch,
    )

    expect(result.success).toBe(true)
    expect(result.success === true && result.attachment).toEqual({
      url: '/api/v1/secure-files/abc-123',
      name: 'test.png',
      type: 'image/png',
      size: 1234,
    })

    // Verify the request shape — server expects multipart with file + context.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/secure-upload/request-upload',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      }),
    )
  })

  // AWTD-1442: Vercel rejects function bodies over 4.5MB before our route runs.
  it('AWTD-1442: sends a >4.5MB file straight to storage, never as multipart to a function', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/secure-upload/get-upload-url') {
        return okResponse({
          fileId: 'big-1',
          pathname: 'files/u/big-1.png',
          presigned: { uploadUrl: 'https://blob.example/put', headers: { 'x-api-version': '12' } },
        })
      }
      if (url === 'https://blob.example/put') return okResponse({})
      if (init?.method === 'HEAD') return okResponse({})
      throw new Error(`unexpected ${url}`)
    })

    const result = await uploadCommentFile(
      makeFile(6 * 1024 * 1024),
      { taskId, attachTarget: 'message' },
      fetchMock as unknown as typeof fetch,
    )

    expect(result.success).toBe(true)
    expect(result.success === true && result.attachment).toEqual({
      url: '/api/v1/secure-files/big-1',
      name: 'test.png',
      type: 'image/png',
      size: 6 * 1024 * 1024,
    })
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.body).not.toBeInstanceOf(FormData)
    }
    const urls = fetchMock.mock.calls.map(c => c[0])
    expect(urls).not.toContain('/api/v1/secure-upload/request-upload')
    const meta = JSON.parse(fetchMock.mock.calls[0][1]!.body as string)
    expect(meta.context).toEqual({ taskId, attachTarget: 'message' })
    const put = fetchMock.mock.calls.find(c => c[0] === 'https://blob.example/put')![1]!
    expect(put.method).toBe('PUT')
    expect((put.headers as Record<string, string>)['Content-Type']).toBe('image/png')
    expect((put.headers as Record<string, string>)['x-api-version']).toBe('12')
  })

  it('AWTD-1442: reports a clear size message when the platform answers 413', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 413,
      json: async () => {
        throw new Error('not json')
      },
    } as unknown as Response)

    const result = await uploadCommentFile(makeFile(1000), taskId, fetchMock as unknown as typeof fetch)

    expect(result.success).toBe(false)
    expect(result.success === false && result.error).toMatch(/too large/i)
  })

  it('translates server-side size errors to the friendly message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      errResponse(413, { error: 'Payload exceeds 100MB limit' }),
    )

    const result = await uploadCommentFile(
      makeFile(50_000_000),
      taskId,
      fetchMock as unknown as typeof fetch,
    )

    expect(result.success).toBe(false)
    expect(result.success === false && result.error).toMatch(/100MB/)
    expect(result.success === false && result.error).toMatch(/Google Drive|Dropbox/)
  })

  it('passes through arbitrary server errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      errResponse(500, { error: 'Storage backend unavailable' }),
    )

    const result = await uploadCommentFile(
      makeFile(1000),
      taskId,
      fetchMock as unknown as typeof fetch,
    )

    expect(result.success).toBe(false)
    expect(result.success === false && result.error).toBe('Storage backend unavailable')
  })

  it('uses a fallback message when server returns no error body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errResponse(500))

    const result = await uploadCommentFile(
      makeFile(1000),
      taskId,
      fetchMock as unknown as typeof fetch,
    )

    expect(result.success).toBe(false)
    expect(result.success === false && result.error).toBe('Failed to upload file')
  })

  it('captures network failures as error results, never throws', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await uploadCommentFile(
      makeFile(1000),
      taskId,
      fetchMock as unknown as typeof fetch,
    )

    expect(result.success).toBe(false)
    expect(result.success === false && result.error).toBe('ECONNREFUSED')
  })
})
