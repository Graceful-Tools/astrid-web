/**
 * Task e0613ae5 (found while hunting the "client-supplied id trusted without a
 * check" shape that produced the user-search leak).
 *
 * `/api/settings/reminders/unsubscribe` accepted a bare `userId` and disabled
 * that user's email reminders with no authentication. These tests pin the
 * signing that replaces it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createUnsubscribeToken, verifyUnsubscribeToken } from '@/lib/unsubscribe-token'

const ORIGINAL = process.env.NEXTAUTH_SECRET

beforeEach(() => { process.env.NEXTAUTH_SECRET = 'test-secret' })
afterEach(() => { process.env.NEXTAUTH_SECRET = ORIGINAL })

describe('unsubscribe tokens (task e0613ae5)', () => {
  it('accepts the token it issued', () => {
    const token = createUnsubscribeToken('user-1')
    expect(verifyUnsubscribeToken('user-1', token)).toBe(true)
  })

  it("rejects another user's token — the whole point", () => {
    // Knowing a user id must no longer be enough to unsubscribe them.
    const token = createUnsubscribeToken('user-1')
    expect(verifyUnsubscribeToken('user-2', token)).toBe(false)
  })

  it('rejects a missing token, so old unsigned links stop working', () => {
    expect(verifyUnsubscribeToken('user-1', null)).toBe(false)
    expect(verifyUnsubscribeToken('user-1', undefined)).toBe(false)
    expect(verifyUnsubscribeToken('user-1', '')).toBe(false)
  })

  it('rejects a garbage token, including one of the right length', () => {
    const real = createUnsubscribeToken('user-1')
    const sameLengthGarbage = 'f'.repeat(real.length)

    expect(verifyUnsubscribeToken('user-1', 'nonsense')).toBe(false)
    expect(verifyUnsubscribeToken('user-1', sameLengthGarbage)).toBe(false)
  })

  it('is stable across calls, so a link keeps working after it is sent', () => {
    // Deliberately not time-based: an unsubscribe link that expires is worse
    // than one that does not, because the alternative is a spam report.
    expect(createUnsubscribeToken('user-1')).toBe(createUnsubscribeToken('user-1'))
  })

  it('changes with the secret, so tokens do not survive a key rotation', () => {
    const before = createUnsubscribeToken('user-1')
    process.env.NEXTAUTH_SECRET = 'a-different-secret'
    expect(createUnsubscribeToken('user-1')).not.toBe(before)
  })

  it('verifies false rather than throwing when the secret is missing', () => {
    // A misconfigured deploy must fail closed, not 500 on every unsubscribe.
    delete process.env.NEXTAUTH_SECRET
    expect(verifyUnsubscribeToken('user-1', 'anything')).toBe(false)
  })
})
