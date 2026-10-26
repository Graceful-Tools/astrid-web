import { createHmac, createPublicKey, timingSafeEqual, verify } from 'crypto'

/**
 * Verify a Vercel Blob `onUploadCompleted` callback signature.
 *
 * Vercel signs the callback as HMAC-SHA256(rawBody) keyed by the blob
 * read/write token and sends it in `x-vercel-signature`. The upload-complete
 * route previously trusted the callback body with NO verification, so anyone
 * could POST a forged `tokenPayload` and attach an arbitrary blob URL onto
 * any victim's task/comment/list. This makes the route reject unsigned or
 * mis-signed callbacks.
 *
 * Pure + synchronous so it's unit-testable (tests/lib/blob-callback-signature.test.ts).
 */
export function computeBlobCallbackSignature(rawBody: string, token: string): string {
  return createHmac('sha256', token).update(rawBody).digest('hex')
}

export function verifyBlobCallbackSignature(
  rawBody: string,
  signature: string | null | undefined,
  token: string | undefined
): boolean {
  if (!token || !signature) return false
  const expected = computeBlobCallbackSignature(rawBody, token)
  // Hex strings of equal length → constant-time compare. Length guard first
  // (timingSafeEqual throws on length mismatch).
  if (signature.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

/** An Ed25519 signature is 64 bytes, sent as 128 hex characters. */
const ED25519_SIGNATURE_HEX = /^[0-9a-fA-F]{128}$/

/**
 * Verify a PRESIGNED upload's callback: Ed25519 over the raw body, checked
 * against the store's `BLOB_WEBHOOK_PUBLIC_KEY` (PEM, SPKI). The same check
 * `handleUploadPresigned` makes in `@vercel/blob` — kept here so the route can
 * verify both schemes from one raw body (AWTD-1368).
 */
export function verifyPresignedBlobCallbackSignature(
  rawBody: string,
  signature: string | null | undefined,
  webhookPublicKey: string | undefined
): boolean {
  if (!webhookPublicKey || !signature || !ED25519_SIGNATURE_HEX.test(signature)) return false
  try {
    const key = createPublicKey(webhookPublicKey.trim())
    return verify(null, Buffer.from(rawBody, 'utf8'), key, Buffer.from(signature, 'hex'))
  } catch {
    return false
  }
}

/**
 * Verify an upload-completed callback under whichever scheme signed it
 * (AWTD-1368).
 *
 * Presigned uploads are signed with Ed25519 and client-token uploads with an
 * HMAC keyed by the read/write token. Both are accepted while both
 * credentials exist, because builds that predate presigned uploads keep
 * producing HMAC callbacks until they drain. After the Blob store's OIDC
 * upgrade the token is gone and only Ed25519 remains, with no code change.
 * Each scheme needs its own credential, so a forger holding neither
 * satisfies neither.
 */
export function verifyBlobCallback(
  rawBody: string,
  signature: string | null | undefined,
  credentials: { webhookPublicKey?: string; readWriteToken?: string }
): boolean {
  return (
    verifyPresignedBlobCallbackSignature(rawBody, signature, credentials.webhookPublicKey) ||
    verifyBlobCallbackSignature(rawBody, signature, credentials.readWriteToken)
  )
}
