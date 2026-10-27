/**
 * AWTD-1286: the S3-compatible store, against a stubbed fetch.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createS3ObjectStore } from '@/lib/storage/s3-object-store'

const env = {
  S3_BUCKET: 'attachments',
  S3_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  S3_SECRET_ACCESS_KEY: 'secret',
}

function stubFetch(...responses: Response[]) {
  const calls: Request[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(new Request(input, init))
    return responses.shift() ?? new Response(null, { status: 500 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('S3 object store (AWTD-1286)', () => {
  it('addresses AWS by virtual host, and signs with SigV4', async () => {
    const calls = stubFetch(new Response(null, { status: 200 }))
    await createS3ObjectStore({ ...env, S3_REGION: 'eu-west-1' }).put('files/u/a.pdf', new Uint8Array([1]), 'application/pdf')
    expect(calls[0].method).toBe('PUT')
    expect(calls[0].url).toBe('https://attachments.s3.eu-west-1.amazonaws.com/files/u/a.pdf')
    expect(calls[0].headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/eu-west-1\/s3\//)
    expect(calls[0].headers.get('content-type')).toBe('application/pdf')
  })

  it('goes path-style to a custom endpoint (MinIO, R2)', async () => {
    const calls = stubFetch(new Response(null, { status: 200 }))
    await createS3ObjectStore({ ...env, S3_ENDPOINT: 'http://minio:9000/' }).put('files/u/a.pdf', new Uint8Array([1]), 'application/pdf')
    expect(calls[0].url).toBe('http://minio:9000/attachments/files/u/a.pdf')
  })

  it('reads an object, passing a range through', async () => {
    const calls = stubFetch(new Response('234', {
      status: 206,
      headers: { 'content-type': 'video/mp4', 'content-length': '3', 'content-range': 'bytes 2-4/10' },
    }))
    const got = await createS3ObjectStore({ ...env, S3_REGION: 'us-east-1' }).get('files/u/v.mp4', 'bytes=2-4')
    expect(calls[0].headers.get('range')).toBe('bytes=2-4')
    expect(got).toMatchObject({ contentType: 'video/mp4', size: 3, contentRange: 'bytes 2-4/10' })
  })

  it('serves the whole object when the store calls a range unsatisfiable', async () => {
    const calls = stubFetch(new Response(null, { status: 416 }), new Response('all', { status: 200 }))
    const got = await createS3ObjectStore({ ...env, S3_REGION: 'us-east-1' }).get('files/u/v.mp4', 'bytes=99-')
    expect(calls).toHaveLength(2)
    expect(calls[1].headers.get('range')).toBeNull()
    expect(got?.contentRange).toBeUndefined()
  })

  it('returns null for a missing object, and treats a missing delete as done', async () => {
    stubFetch(new Response(null, { status: 404 }), new Response(null, { status: 404 }))
    const store = createS3ObjectStore({ ...env, S3_REGION: 'us-east-1' })
    expect(await store.get('files/u/none')).toBeNull()
    await expect(store.delete('files/u/none')).resolves.toBeUndefined()
  })

  it('reports a failed write with the store’s status', async () => {
    stubFetch(new Response('AccessDenied', { status: 403 }))
    await expect(
      createS3ObjectStore({ ...env, S3_REGION: 'us-east-1' }).put('files/u/a', new Uint8Array([1]), 'text/plain')
    ).rejects.toThrow(/S3 PUT failed: 403 AccessDenied/)
  })

  it('never builds a URL from an unsafe pathname', async () => {
    stubFetch()
    await expect(
      createS3ObjectStore({ ...env, S3_REGION: 'us-east-1' }).get('../other-bucket/x')
    ).rejects.toThrow(/Invalid object pathname/)
  })
})
