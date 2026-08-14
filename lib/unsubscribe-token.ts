/**
 * Signed tokens for one-click unsubscribe links.
 *
 * `/api/settings/reminders/unsubscribe` took a raw `userId` from the URL and
 * disabled that user's email reminders, with no authentication of any kind.
 * Two problems, and the second is the one that bites without an attacker:
 *
 *   1. Anyone who learned a user id could silently switch off someone else's
 *      reminders. User ids are not secret — they are returned as task
 *      creators, assignees, list members and comment authors.
 *   2. It is a GET with a side effect, so any link prefetcher — an email
 *      client, a security scanner, a chat link preview — unsubscribes the
 *      recipient just by fetching the link. This is why RFC 8058 one-click
 *      unsubscribe is a POST.
 *
 * An unsubscribe link cannot require a session (the whole point is that it
 * works from an email, often in a different browser), so the link itself has
 * to carry the proof. This signs the user id with NEXTAUTH_SECRET.
 *
 * Deliberately NOT expiring: an unsubscribe link that stops working is worse
 * than one that keeps working, because the alternative for the recipient is to
 * mark the mail as spam. The token proves the link was issued by us, which is
 * all it needs to prove.
 */

import { createHmac, timingSafeEqual } from 'crypto'

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET
  if (!value) throw new Error('NEXTAUTH_SECRET is required to sign unsubscribe links')
  return value
}

export function createUnsubscribeToken(userId: string): string {
  return createHmac('sha256', secret())
    .update(`unsubscribe:${userId}`)
    .digest('hex')
}

/**
 * Constant-time comparison — a plain `===` on an HMAC leaks its prefix through
 * timing, which is the standard way these get brute-forced.
 */
export function verifyUnsubscribeToken(userId: string, token: string | null | undefined): boolean {
  if (!token) return false

  let expected: string
  try {
    expected = createUnsubscribeToken(userId)
  } catch {
    return false
  }

  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(token, 'utf8')
  // timingSafeEqual throws on length mismatch, which would itself be a length
  // oracle; compare lengths first and still run the constant-time check.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
