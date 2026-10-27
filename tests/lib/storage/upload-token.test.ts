/**
 * AWTD-1286: the signed grant a self-hosted direct upload carries.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createUploadToken, verifyUploadToken, UPLOAD_TOKEN_TTL_MS } from '@/lib/storage/upload-token'

const saved = process.env.NEXTAUTH_SECRET
const grant = {
  pathname: 'files/u/f.pdf',
  allowedContentTypes: ['application/pdf'],
  maximumSizeInBytes: 1000,
  tokenPayload: '{"userId":"u","fileId":"f"}',
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'a'.repeat(40)
})

afterEach(() => {
  process.env.NEXTAUTH_SECRET = saved
})

describe('upload tokens (AWTD-1286)', () => {
  it('round-trips the grant', () => {
    const verified = verifyUploadToken(createUploadToken(grant, 1_000), 2_000)
    expect(verified).toEqual({ ...grant, expiresAt: 1_000 + UPLOAD_TOKEN_TTL_MS })
  })

  it('is URL-safe, so it can sit in a path segment', () => {
    expect(createUploadToken(grant)).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  })

  it('refuses an expired grant', () => {
    expect(verifyUploadToken(createUploadToken(grant, 0), UPLOAD_TOKEN_TTL_MS + 1)).toBeNull()
  })

  it('refuses a grant whose body was edited', () => {
    const [, signature] = createUploadToken(grant).split('.')
    const forged = Buffer.from(JSON.stringify({ ...grant, pathname: 'files/victim/x.pdf', expiresAt: Date.now() + 1e6 })).toString('base64url')
    expect(verifyUploadToken(`${forged}.${signature}`)).toBeNull()
  })

  it('refuses a grant signed under another secret', () => {
    const token = createUploadToken(grant)
    process.env.NEXTAUTH_SECRET = 'b'.repeat(40)
    expect(verifyUploadToken(token)).toBeNull()
  })

  it('refuses malformed tokens', () => {
    expect(verifyUploadToken('')).toBeNull()
    expect(verifyUploadToken('abc')).toBeNull()
    expect(verifyUploadToken('a.b.c')).toBeNull()
  })
})
