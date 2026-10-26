/**
 * AWTD-1368: upload-completed callbacks for PRESIGNED uploads are signed with
 * Ed25519 against `BLOB_WEBHOOK_PUBLIC_KEY`, not with an HMAC keyed by
 * `BLOB_READ_WRITE_TOKEN`. Once the Blob store is upgraded to OIDC the token
 * no longer exists, so a verifier that only knows HMAC rejects every callback
 * and no SecureFile row is ever written — the upload lands and is lost.
 *
 * Both schemes are accepted while both credentials exist, because builds that
 * still upload with a client token keep producing HMAC-signed callbacks.
 */
import { describe, it, expect } from 'vitest'
import { createHmac, generateKeyPairSync, sign } from 'crypto'
import { verifyBlobCallback } from '@/lib/blob-callback-signature'

const BODY = JSON.stringify({ type: 'blob.upload-completed', payload: { blob: { url: 'x' } } })
const TOKEN = 'vercel_blob_rw_test_token_value'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const ed25519Sig = (body: string, key = privateKey) => sign(null, Buffer.from(body), key).toString('hex')
const hmacSig = (body: string) => createHmac('sha256', TOKEN).update(body).digest('hex')

describe('verifyBlobCallback (AWTD-1368)', () => {
  it('AWTD-1368: accepts an Ed25519-signed presigned callback when the webhook key is set', () => {
    expect(verifyBlobCallback(BODY, ed25519Sig(BODY), { webhookPublicKey: PUBLIC_PEM })).toBe(true)
  })

  it('AWTD-1368: accepts it with no read/write token at all (the post-OIDC state)', () => {
    expect(
      verifyBlobCallback(BODY, ed25519Sig(BODY), { webhookPublicKey: PUBLIC_PEM, readWriteToken: undefined }),
    ).toBe(true)
  })

  it('AWTD-1368: rejects an Ed25519 signature over a tampered body', () => {
    const tampered = BODY.replace('"x"', '"https://evil.example/x"')
    expect(verifyBlobCallback(tampered, ed25519Sig(BODY), { webhookPublicKey: PUBLIC_PEM })).toBe(false)
  })

  it('AWTD-1368: rejects an Ed25519 signature from a different key', () => {
    const other = generateKeyPairSync('ed25519').privateKey
    expect(verifyBlobCallback(BODY, ed25519Sig(BODY, other), { webhookPublicKey: PUBLIC_PEM })).toBe(false)
  })

  it('AWTD-1368: rejects an Ed25519 signature when no webhook key is configured', () => {
    expect(verifyBlobCallback(BODY, ed25519Sig(BODY), { readWriteToken: TOKEN })).toBe(false)
  })

  it('AWTD-1368: still accepts a legacy HMAC callback while the token exists, key or not', () => {
    expect(verifyBlobCallback(BODY, hmacSig(BODY), { readWriteToken: TOKEN })).toBe(true)
    expect(verifyBlobCallback(BODY, hmacSig(BODY), { readWriteToken: TOKEN, webhookPublicKey: PUBLIC_PEM })).toBe(true)
  })

  it('AWTD-1368: rejects everything when neither credential is configured', () => {
    expect(verifyBlobCallback(BODY, ed25519Sig(BODY), {})).toBe(false)
    expect(verifyBlobCallback(BODY, hmacSig(BODY), {})).toBe(false)
  })

  it('AWTD-1368: rejects a missing or garbage signature without throwing', () => {
    const creds = { webhookPublicKey: PUBLIC_PEM, readWriteToken: TOKEN }
    expect(verifyBlobCallback(BODY, null, creds)).toBe(false)
    expect(verifyBlobCallback(BODY, '', creds)).toBe(false)
    expect(verifyBlobCallback(BODY, 'zz'.repeat(64), creds)).toBe(false)
    expect(verifyBlobCallback(BODY, ed25519Sig(BODY), { webhookPublicKey: 'not a pem' })).toBe(false)
  })
})
