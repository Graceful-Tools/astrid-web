/**
 * Signature verification for the inbound email-to-task webhooks (task 0a5b6337).
 *
 * Extracted from the route because both schemes were wrong in ways that a
 * route-shaped test could not reach:
 *
 *   - Resend verification had NEVER worked. It called request.text() after the
 *     handler had already consumed request.json(); the body is a one-shot
 *     stream, so it threw and the catch returned false, 401ing every genuine
 *     delivery. And it read a bare `resend-signature` hex header, while Resend
 *     signs with Svix — so fixing the body read alone would not have helped.
 *
 *   - The Mailgun HMAC covered timestamp + token but never compared the
 *     timestamp to now, so a captured body could be replayed indefinitely,
 *     recreating tasks and placeholder users each time.
 *
 * Both schemes now share one tolerance window, and both take strings rather
 * than a Request, so they can be tested against genuinely signed fixtures.
 */

import crypto from 'crypto'

/**
 * How far a signed timestamp may be from now, in either direction.
 *
 * Five minutes is Svix's own recommendation. The future direction matters too:
 * a clock-skewed or forged-ahead timestamp would otherwise buy an attacker an
 * arbitrarily long replay window.
 */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60

function timestampWithinTolerance(seconds: number, now = Date.now()): boolean {
  if (!Number.isFinite(seconds)) return false
  const deltaSeconds = Math.abs(now / 1000 - seconds)
  return deltaSeconds <= SIGNATURE_TOLERANCE_SECONDS
}

/**
 * Constant-time comparison that tolerates differing lengths.
 *
 * crypto.timingSafeEqual THROWS when the buffers differ in length, and the
 * value being compared arrives in the request. The old Mailgun path relied on
 * that throw reaching a catch — the right answer by the wrong route, and it
 * meant the timing-safe comparison was never reached for the case it exists to
 * protect.
 */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

/**
 * Verify a Resend (Svix) webhook.
 *
 * Svix signs `${id}.${timestamp}.${body}` with the base64 secret that follows
 * the `whsec_` prefix, and sends a space-separated list of versioned
 * signatures so a key rotation can be served by two secrets at once.
 *
 * @param rawBody the body EXACTLY as received — parse JSON from this same
 *   string, never re-serialise, or the bytes stop matching the signature.
 */
export function verifySvixSignature(
  rawBody: string,
  headers: Record<string, string | null | undefined>,
  secret: string,
  now = Date.now()
): boolean {
  try {
    const id = headers['svix-id']
    const timestamp = headers['svix-timestamp']
    const signatureHeader = headers['svix-signature']
    if (!id || !timestamp || !signatureHeader) return false

    if (!timestampWithinTolerance(Number(timestamp), now)) return false

    const secretBytes = Buffer.from(
      secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret,
      'base64'
    )

    const expected = crypto
      .createHmac('sha256', secretBytes)
      .update(`${id}.${timestamp}.${rawBody}`)
      .digest('base64')

    // Any one of the offered versioned signatures may match.
    return signatureHeader
      .split(' ')
      .map((part) => part.trim())
      .filter(Boolean)
      .some((part) => {
        const [version, value] = part.split(',')
        return version === 'v1' && value !== undefined && safeEqual(value, expected)
      })
  } catch {
    return false
  }
}

/**
 * Verify a Mailgun webhook.
 *
 * HMAC-SHA256 over `timestamp + token`, and — the part that was missing — the
 * timestamp must be recent. Without that check the signature stays valid
 * forever, so one captured request recreates tasks on every replay.
 */
export function verifyMailgunSignature(
  fields: { timestamp?: string | null; token?: string | null; signature?: string | null },
  signingKey: string,
  now = Date.now()
): boolean {
  try {
    const { timestamp, token, signature } = fields
    if (!timestamp || !token || !signature) return false

    if (!timestampWithinTolerance(Number(timestamp), now)) return false

    const expected = crypto
      .createHmac('sha256', signingKey)
      .update(timestamp + token)
      .digest('hex')

    return safeEqual(signature, expected)
  } catch {
    return false
  }
}
