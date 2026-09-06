/**
 * RED for task 0a5b6337 — the inbound email-to-task webhooks.
 *
 * Three defects, in order of severity:
 *
 *   1. Resend verification has never worked. verifyWebhookSignature called
 *      request.text() after the handler had already consumed request.json();
 *      the body is a one-shot stream, so it threw and the catch returned false.
 *      It also read a bare `resend-signature` hex header, but Resend signs with
 *      Svix (svix-id / svix-timestamp / svix-signature, a whsec_ base64 secret,
 *      signed content `id.timestamp.body`).
 *   2. The Mailgun HMAC covers timestamp + token but never compares the
 *      timestamp to now, so a captured body replays indefinitely — each replay
 *      recreating tasks and placeholder users.
 *   3. The acting user came straight from the From header. Anyone able to get a
 *      message to the inbound address could act as any user, and the group
 *      routing then creates a shared list and invites every recipient.
 *
 * The fixtures below are signed with the same primitives the verifier uses, so
 * a test cannot pass by agreeing with a bug.
 */
import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import {
  verifySvixSignature,
  verifyMailgunSignature,
  SIGNATURE_TOLERANCE_SECONDS,
} from '@/lib/webhooks/inbound-email-signatures'

const SVIX_SECRET = `whsec_${Buffer.from('a-shared-signing-secret-value').toString('base64')}`
const MAILGUN_KEY = 'mailgun-signing-key'

function svixHeaders(body: string, { id = 'msg_1', timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const key = Buffer.from(SVIX_SECRET.split('_')[1], 'base64')
  const signature = crypto
    .createHmac('sha256', key)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64')
  return {
    'svix-id': id,
    'svix-timestamp': String(timestamp),
    'svix-signature': `v1,${signature}`,
  }
}

function mailgunFields({ timestamp = Math.floor(Date.now() / 1000), token = 'tok' } = {}) {
  const signature = crypto
    .createHmac('sha256', MAILGUN_KEY)
    .update(`${timestamp}${token}`)
    .digest('hex')
  return { timestamp: String(timestamp), token, signature }
}

describe('Resend / Svix signature verification (task 0a5b6337)', () => {
  const body = JSON.stringify({ type: 'email.received', data: { from: 'a@b.test' } })

  it('accepts a correctly signed payload', () => {
    expect(verifySvixSignature(body, svixHeaders(body), SVIX_SECRET)).toBe(true)
  })

  it('rejects a tampered body', () => {
    const headers = svixHeaders(body)
    expect(verifySvixSignature(body + ' ', headers, SVIX_SECRET)).toBe(false)
  })

  it('rejects a signature made with a different secret', () => {
    const headers = svixHeaders(body)
    const otherSecret = `whsec_${Buffer.from('different').toString('base64')}`
    expect(verifySvixSignature(body, headers, otherSecret)).toBe(false)
  })

  it('rejects a stale timestamp even when the signature is valid', () => {
    const stale = Math.floor(Date.now() / 1000) - (SIGNATURE_TOLERANCE_SECONDS + 60)
    const headers = svixHeaders(body, { timestamp: stale })
    // Genuinely signed for that timestamp — only the age makes it invalid.
    expect(verifySvixSignature(body, headers, SVIX_SECRET)).toBe(false)
  })

  it('rejects a timestamp far in the future', () => {
    const future = Math.floor(Date.now() / 1000) + (SIGNATURE_TOLERANCE_SECONDS + 60)
    expect(verifySvixSignature(body, svixHeaders(body, { timestamp: future }), SVIX_SECRET)).toBe(false)
  })

  it('rejects a missing signature header rather than throwing', () => {
    expect(verifySvixSignature(body, {}, SVIX_SECRET)).toBe(false)
  })

  it('accepts a multi-signature header containing one valid version', () => {
    // Svix sends space-separated versioned signatures during key rotation.
    const headers = svixHeaders(body)
    headers['svix-signature'] = `v1,not-the-right-one ${headers['svix-signature']}`
    expect(verifySvixSignature(body, headers, SVIX_SECRET)).toBe(true)
  })
})

describe('Mailgun signature verification (task 0a5b6337)', () => {
  it('accepts a correctly signed request', () => {
    expect(verifyMailgunSignature(mailgunFields(), MAILGUN_KEY)).toBe(true)
  })

  it('rejects a replay of a genuinely signed but stale request', () => {
    const stale = Math.floor(Date.now() / 1000) - (SIGNATURE_TOLERANCE_SECONDS + 60)
    // The HMAC is correct. Only the age makes it a replay.
    expect(verifyMailgunSignature(mailgunFields({ timestamp: stale }), MAILGUN_KEY)).toBe(false)
  })

  it('rejects a wrong-length signature without throwing', () => {
    // crypto.timingSafeEqual throws on differing lengths, and the signature is
    // attacker-supplied, so the length has to be checked first.
    const fields = { ...mailgunFields(), signature: 'abc' }
    expect(() => verifyMailgunSignature(fields, MAILGUN_KEY)).not.toThrow()
    expect(verifyMailgunSignature(fields, MAILGUN_KEY)).toBe(false)
  })

  it('rejects a signature made with a different key', () => {
    expect(verifyMailgunSignature(mailgunFields(), 'other-key')).toBe(false)
  })

  it('rejects missing fields', () => {
    expect(verifyMailgunSignature({ timestamp: '', token: '', signature: '' }, MAILGUN_KEY)).toBe(false)
  })
})
