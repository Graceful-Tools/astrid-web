/**
 * What a client may claim about WHEN something was completed (AWTD-873).
 *
 * astrid-ios answered AWTD-861: four completions carrying an identical
 * `2026-09-08T14:02:37.000Z` were not an event storm. They were one offline
 * Outbox drained six and a half minutes late, each PUT replaying the timestamp it
 * had been holding since enqueue. The client-supplied stamp was 6.5 minutes stale
 * and the server took it without a word.
 *
 * That skew is the FEATURE, not the bug — an offline-first client must record when
 * a completion happened, not when it drained. So the answer is not to stop trusting
 * `completedAt`; it is to bound what cannot possibly be true.
 *
 * The iOS note suggested rejecting a stamp older than the row's `createdAt`. That
 * one is wrong for this codebase, and the counter-example is in the tree:
 * `lib/sync/github/apply-issues.ts` writes `completedAt` from an issue's
 * `closed_at`, so importing an issue closed last year onto a row created today is
 * both legitimate and routine. Backwards has no defensible floor here.
 *
 * FORWARDS does. Nothing is completed in the future, from any client, ever.
 */

import { describe, it, expect } from 'vitest'
import { parseCompletedAt } from '@/lib/task-enums'

const NOW = new Date('2026-09-09T12:00:00.000Z')

describe('parseCompletedAt (AWTD-873)', () => {
  it('accepts an absent stamp — the server will stamp now', () => {
    expect(parseCompletedAt(undefined, NOW)).toEqual({ ok: true, value: undefined })
    expect(parseCompletedAt(null, NOW)).toEqual({ ok: true, value: undefined })
  })

  it('accepts a stamp in the past, however old', () => {
    // The offline queue's whole purpose, and GitHub issue import's too: a task
    // can legitimately have been completed long before this row existed.
    const old = '2019-03-04T08:15:00.000Z'
    const parsed = parseCompletedAt(old, NOW)
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.value?.toISOString()).toBe(old)
  })

  it('accepts the 6.5-minute stale stamp from the real incident', () => {
    // AWTD-861's four rows. This must keep working — it is a correct client
    // reporting a real completion time after a delayed drain.
    const parsed = parseCompletedAt('2026-09-08T14:02:37.000Z', NOW)
    expect(parsed.ok).toBe(true)
  })

  it('REJECTS a stamp in the future', () => {
    // Nothing has been completed in the future. A client whose clock is wrong,
    // or a caller sending a scheduled date by mistake, corrupts the audit trail
    // in a way nothing downstream can detect later.
    const parsed = parseCompletedAt('2027-01-01T00:00:00.000Z', NOW)
    expect(parsed.ok).toBe(false)
    expect(parsed.ok === false && parsed.error).toMatch(/future/i)
  })

  it('tolerates ordinary clock skew rather than punishing it', () => {
    // A phone a few seconds ahead of the server is normal and must not fail a
    // completion. The bound exists to catch nonsense, not to enforce NTP.
    const slightlyAhead = new Date(NOW.getTime() + 30_000).toISOString()
    expect(parseCompletedAt(slightlyAhead, NOW).ok).toBe(true)

    const wayAhead = new Date(NOW.getTime() + 48 * 60 * 60 * 1000).toISOString()
    expect(parseCompletedAt(wayAhead, NOW).ok).toBe(false)
  })

  it('REJECTS an unparseable stamp instead of writing an Invalid Date', () => {
    // `new Date('yesterday')` is an Invalid Date. Prisma rejects it, so today
    // this surfaces as a 500 on the surfaces that do not pre-validate — the v1
    // route checks it, the MCP, legacy and agent paths do not.
    for (const bad of ['yesterday', '2026-13-45', '', 'null']) {
      const parsed = parseCompletedAt(bad, NOW)
      expect(parsed.ok, `expected ${JSON.stringify(bad)} to be rejected`).toBe(false)
    }
  })

  it('accepts a Date as well as a string, since the service takes both', () => {
    const d = new Date('2020-01-01T00:00:00.000Z')
    const parsed = parseCompletedAt(d, NOW)
    expect(parsed.ok && parsed.value?.toISOString()).toBe(d.toISOString())
  })

  it('names the field, so the 400 tells the caller what to fix', () => {
    const parsed = parseCompletedAt('nonsense', NOW)
    expect(parsed.ok === false && parsed.error).toMatch(/completedAt/)
  })
})
