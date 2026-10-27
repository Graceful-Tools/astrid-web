/**
 * AWTD-1368: the presigned upload request web hands iOS/Mac.
 *
 * astrid-ios (AITD-558) PUTs `presigned.uploadUrl` with `presigned.headers`
 * as given, adding only Content-Type and never an Authorization header. So
 * the server composes the whole request, which is why the URL and headers
 * are pinned here rather than left to a client.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const issueSignedToken = vi.hoisted(() => vi.fn())
const presignUrl = vi.hoisted(() => vi.fn())
const parseStoreIdFromDelegationToken = vi.hoisted(() => vi.fn())

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
  del: vi.fn(),
  getDownloadUrl: vi.fn(),
  issueSignedToken,
  presignUrl,
  parseStoreIdFromDelegationToken,
}))
vi.mock('@vercel/blob/client', () => ({ generateClientTokenFromReadWriteToken: vi.fn() }))

import { issuePresignedUpload, presignedUploadsEnabled } from '@/lib/secure-storage'

const saved = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  issueSignedToken.mockResolvedValue({ delegationToken: 'deleg', clientSigningToken: 'csk', validUntil: 1 })
  presignUrl.mockResolvedValue({ presignedUrl: 'https://vercel.com/api/blob/?pathname=files%2Fu%2Ff.pdf&sig=1' })
  parseStoreIdFromDelegationToken.mockReturnValue('abc123')
})

afterEach(() => {
  process.env = { ...saved }
})

describe('presignedUploadsEnabled (AWTD-1368)', () => {
  it('AWTD-1368: is off without the webhook public key, so callbacks can never go unverifiable', () => {
    delete process.env.BLOB_WEBHOOK_PUBLIC_KEY
    expect(presignedUploadsEnabled()).toBe(false)
  })

  it('AWTD-1368: is on once the webhook public key exists', () => {
    process.env.BLOB_WEBHOOK_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----'
    expect(presignedUploadsEnabled()).toBe(true)
  })
})

describe('issuePresignedUpload (AWTD-1368)', () => {
  const request = {
    pathname: 'files/u/f.pdf',
    contentType: 'application/pdf',
    allowedContentTypes: ['application/pdf'],
    maximumSizeInBytes: 100,
    onUploadCompleted: { callbackUrl: 'https://app.example/api/secure-upload/upload-complete', tokenPayload: '{"a":1}' },
  }

  it('AWTD-1368: scopes the delegation to this one pathname, put only, with the limits', async () => {
    await issuePresignedUpload(request)
    expect(issueSignedToken).toHaveBeenCalledWith({
      pathname: 'files/u/f.pdf',
      operations: ['put'],
      allowedContentTypes: ['application/pdf'],
      maximumSizeInBytes: 100,
    })
  })

  it('AWTD-1368: passes no static token, so the SDK resolves OIDC or the env token itself', async () => {
    await issuePresignedUpload(request)
    expect(issueSignedToken.mock.calls[0][0]).not.toHaveProperty('token')
  })

  it('AWTD-1368: signs the completion callback into the presigned URL', async () => {
    await issuePresignedUpload(request)
    expect(presignUrl).toHaveBeenCalledWith(
      { delegationToken: 'deleg', clientSigningToken: 'csk', validUntil: 1 },
      expect.objectContaining({
        operation: 'put',
        pathname: 'files/u/f.pdf',
        access: 'public',
        allowedContentTypes: ['application/pdf'],
        maximumSizeInBytes: 100,
        onUploadCompleted: request.onUploadCompleted,
      }),
    )
  })

  it('AWTD-1368: returns the PUT the app sends as given — store id, access, version, no Authorization', async () => {
    const out = await issuePresignedUpload(request)
    expect(parseStoreIdFromDelegationToken).toHaveBeenCalledWith('deleg')
    expect(out.uploadUrl).toBe('https://vercel.com/api/blob/?pathname=files%2Fu%2Ff.pdf&sig=1')
    expect(out.headers).toEqual({
      'x-api-version': expect.stringMatching(/^\d+$/),
      'x-vercel-blob-store-id': 'abc123',
      'x-vercel-blob-access': 'public',
      'x-content-type': 'application/pdf',
    })
    expect(Object.keys(out.headers).map((h) => h.toLowerCase())).not.toContain('authorization')
  })
})
