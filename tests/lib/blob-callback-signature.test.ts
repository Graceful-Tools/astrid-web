import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import {
  computeBlobCallbackSignature,
  verifyBlobCallbackSignature,
} from '@/lib/blob-callback-signature'

const TOKEN = 'vercel_blob_rw_test_token_value'
const BODY = JSON.stringify({ type: 'blob.upload-completed', payload: { blob: { url: 'x' } } })
const validSig = createHmac('sha256', TOKEN).update(BODY).digest('hex')

describe('verifyBlobCallbackSignature', () => {
  it('accepts a correctly-signed callback', () => {
    expect(verifyBlobCallbackSignature(BODY, validSig, TOKEN)).toBe(true)
    expect(computeBlobCallbackSignature(BODY, TOKEN)).toBe(validSig)
  })

  it('rejects a forged callback with no signature (the attack)', () => {
    expect(verifyBlobCallbackSignature(BODY, null, TOKEN)).toBe(false)
    expect(verifyBlobCallbackSignature(BODY, undefined, TOKEN)).toBe(false)
    expect(verifyBlobCallbackSignature(BODY, '', TOKEN)).toBe(false)
  })

  it('rejects a signature over a different body (tampered payload)', () => {
    const tampered = BODY.replace('upload-completed', 'upload-completed-EVIL')
    expect(verifyBlobCallbackSignature(tampered, validSig, TOKEN)).toBe(false)
  })

  it('rejects a signature made with the wrong token', () => {
    const wrongSig = createHmac('sha256', 'other_token').update(BODY).digest('hex')
    expect(verifyBlobCallbackSignature(BODY, wrongSig, TOKEN)).toBe(false)
  })

  it('rejects when the server token is unset', () => {
    expect(verifyBlobCallbackSignature(BODY, validSig, undefined)).toBe(false)
  })

  it('does not throw on non-hex or wrong-length signatures', () => {
    expect(verifyBlobCallbackSignature(BODY, 'not-hex-zz', TOKEN)).toBe(false)
    expect(verifyBlobCallbackSignature(BODY, 'abcd', TOKEN)).toBe(false)
  })
})
