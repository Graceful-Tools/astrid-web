/**
 * The one outbound email transport.
 *
 * `lib/email.ts` and `lib/email-reminder-service.ts` each constructed their own
 * Resend client and each re-implemented the same "development, or no API key →
 * log instead of send" guard (task 1e772f0c). Two clients for one transport is
 * two places to change when the provider moves, and — more immediately — two
 * places for the send/don't-send rule to disagree, which is the kind of drift
 * nobody notices until a partner's staging deployment mails real users.
 *
 * This module is the seam a partner on SendGrid or SES replaces. It is
 * deliberately narrow: subject, recipients, bodies. Everything about WHAT to
 * say — templates, brand copy, the From address — stays with the callers.
 */

import { Resend } from 'resend'
import { createLogger } from '@/lib/logger'

const log = createLogger('email-transport')

/**
 * Lazily constructed, so importing this module never requires a key.
 *
 * The originals built their client at module load, which meant the guard and
 * the client could answer differently if the environment was read at different
 * times. One accessor, one answer.
 */
let client: Resend | null | undefined

function getClient(): Resend | null {
  if (client === undefined) {
    const apiKey = process.env.RESEND_API_KEY
    client = typeof window === 'undefined' && apiKey ? new Resend(apiKey) : null
  }
  return client
}

/**
 * Will a send actually leave the building?
 *
 * False in development and wherever no key is configured — callers log the
 * message they would have sent instead, which is how the invite and
 * verification flows stay testable locally.
 */
export function isEmailTransportLive(): boolean {
  return process.env.NODE_ENV !== 'development' && !!process.env.RESEND_API_KEY && !!getClient()
}

export interface OutboundEmail {
  from: string
  to: string | string[]
  subject: string
  html: string
  text: string
}

/**
 * Send one email, or throw.
 *
 * The provider reports a failure in its RESULT rather than by rejecting, which
 * is easy to drop on the floor — every caller here used to unpack `{ data,
 * error }` and remember to check. Raising it is that check, made once.
 */
export async function sendTransportEmail(email: OutboundEmail): Promise<{ id?: string } | null> {
  const transport = getClient()
  if (!transport) {
    throw new Error('Email transport is not configured (no RESEND_API_KEY)')
  }

  const { data, error } = await transport.emails.send({
    from: email.from,
    to: Array.isArray(email.to) ? email.to : [email.to],
    subject: email.subject,
    html: email.html,
    text: email.text,
  })

  if (error) {
    log.error({ err: error }, 'Email transport error')
    throw new Error(`Email sending failed: ${error.message}`)
  }

  return data ?? null
}

/** Test seam: forget the memoized client so a changed key is picked up. */
export function resetEmailTransportForTests(): void {
  client = undefined
}
