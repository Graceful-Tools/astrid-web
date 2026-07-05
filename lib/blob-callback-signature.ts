import { createHmac, timingSafeEqual } from 'crypto'

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
