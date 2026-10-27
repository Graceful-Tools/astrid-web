/**
 * Signed direct-upload grants for self-hosted storage (AWTD-1286).
 *
 * On Vercel Blob, a large upload goes from the client straight to the store
 * with a presigned URL, and the store calls `/api/secure-upload/upload-complete`
 * once the bytes land. A self-hosted store makes no such callback, so the app
 * is the upload endpoint itself: `issuePresignedUpload` hands out
 * `/api/v1/storage/uploads/<token>`, and this token carries everything the
 * Blob grant did (pathname, allowed types, size limit, expiry, and the
 * completion payload get-upload-url signed for). Clients need no change: they
 * already PUT to whatever URL the server composes (astrid-ios AITD-558).
 *
 * Signed with NEXTAUTH_SECRET, like unsubscribe links, under its own prefix so
 * no other token can be replayed as one of these.
 */

import { createHmac, timingSafeEqual } from 'crypto'

/** Long enough for a large upload on a slow phone connection, short enough to be useless later. */
export const UPLOAD_TOKEN_TTL_MS = 60 * 60 * 1000

export interface UploadGrant {
  pathname: string
  allowedContentTypes: string[]
  maximumSizeInBytes: number
  /** Epoch milliseconds after which the grant is refused. */
  expiresAt: number
  /** The completion payload, as get-upload-url wrote it for the Blob callback. */
  tokenPayload?: string
}

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET
  if (!value) throw new Error('NEXTAUTH_SECRET is required to sign upload grants')
  return value
}

function sign(body: string): string {
  return createHmac('sha256', secret()).update(`storage-upload:v1:${body}`).digest('base64url')
}

export function createUploadToken(grant: Omit<UploadGrant, 'expiresAt'>, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...grant, expiresAt: now + UPLOAD_TOKEN_TTL_MS })).toString('base64url')
  return `${body}.${sign(body)}`
}

/** The grant, or null if the token is malformed, forged or expired. */
export function verifyUploadToken(token: string, now = Date.now()): UploadGrant | null {
  const [body, signature, extra] = token.split('.')
  if (!body || !signature || extra !== undefined) return null

  let expected: string
  try {
    expected = sign(body)
  } catch {
    return null
  }
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  let grant: UploadGrant
  try {
    grant = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof grant.expiresAt !== 'number' || grant.expiresAt < now) return null
  if (typeof grant.pathname !== 'string' || !Array.isArray(grant.allowedContentTypes)) return null
  if (typeof grant.maximumSizeInBytes !== 'number') return null
  return grant
}
