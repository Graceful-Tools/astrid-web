import { createPublicKey, verify } from 'crypto'

/** An Ed25519 signature is 64 bytes, sent as 128 hex characters. */
const ED25519_SIGNATURE_HEX = /^[0-9a-fA-F]{128}$/

/**
 * Verify a PRESIGNED upload's callback: Ed25519 over the raw body, checked
 * against the store's `BLOB_WEBHOOK_PUBLIC_KEY` (PEM, SPKI). The same check
 * `handleUploadPresigned` makes in `@vercel/blob`, kept here so the route can
 * verify the raw body it already read (AWTD-1368).
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
 * Verify an upload-completed callback.
 *
 * Without this the route would trust the callback body, so anyone could POST a
 * forged `tokenPayload` and attach an arbitrary blob URL to any victim's
 * task, comment or list.
 *
 * Ed25519 only. Client-token uploads, whose callbacks were an HMAC keyed by
 * `BLOB_READ_WRITE_TOKEN`, ended with the Blob store's OIDC upgrade
 * (AWTD-1386). The read/write token may still exist for server-side writes,
 * and it must not reopen that path.
 */
export function verifyBlobCallback(
  rawBody: string,
  signature: string | null | undefined,
  credentials: { webhookPublicKey?: string }
): boolean {
  return verifyPresignedBlobCallbackSignature(rawBody, signature, credentials.webhookPublicKey)
}
