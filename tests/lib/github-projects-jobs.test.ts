/**
 * AWTD-1152 (P4d): the sync queue's rules (spec §8.1, §8.7).
 *
 *   - a burst of edits to one item inside 2s is one hydration;
 *   - fairness: round-robin by installation, at most 2 each per drain — one
 *     large org cannot starve another;
 *   - backoff doubles from 30s and caps at an hour.
 */

import { describe, it, expect } from 'vitest'
import { backoffMs, hydrateDedupeKey, pickRoundRobin, MAX_ATTEMPTS } from '@/lib/github/projects/jobs'

describe('hydrateDedupeKey (AWTD-1152)', () => {
  const t = Date.parse('2026-10-10T12:00:00.000Z')

  it('coalesces edits to one item inside the same 2s bucket', () => {
    expect(hydrateDedupeKey('PVTI_a', t)).toBe(hydrateDedupeKey('PVTI_a', t + 1999))
  })

  it('a later edit, or another item, is its own job', () => {
    expect(hydrateDedupeKey('PVTI_a', t)).not.toBe(hydrateDedupeKey('PVTI_a', t + 2000))
    expect(hydrateDedupeKey('PVTI_a', t)).not.toBe(hydrateDedupeKey('PVTI_b', t))
  })
})

describe('pickRoundRobin — fairness across installations (AWTD-1152)', () => {
  const job = (installationId: number, n: number) => ({ id: `${installationId}-${n}`, installationId })

  it("a big org's backlog does not starve a small org's single job", () => {
    const due = [...Array.from({ length: 50 }, (_, n) => job(1, n)), job(2, 0)]
    const picked = pickRoundRobin(due, 3)
    expect(picked.map(j => j.id)).toEqual(['1-0', '2-0', '1-1'])
  })

  it('never more than 2 per installation in one drain', () => {
    const due = Array.from({ length: 10 }, (_, n) => job(1, n))
    expect(pickRoundRobin(due, 20)).toHaveLength(2)
  })

  it('interleaves, oldest first within each installation', () => {
    const due = [job(1, 0), job(1, 1), job(2, 0), job(2, 1), job(3, 0)]
    expect(pickRoundRobin(due, 10).map(j => j.id)).toEqual(['1-0', '2-0', '3-0', '1-1', '2-1'])
  })

  it('respects the overall limit', () => {
    const due = [job(1, 0), job(2, 0), job(3, 0)]
    expect(pickRoundRobin(due, 2)).toHaveLength(2)
  })
})

describe('backoffMs (AWTD-1152)', () => {
  it('30s, doubling, capped at an hour', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([30_000, 60_000, 120_000, 240_000])
    expect(backoffMs(20)).toBe(3_600_000)
  })

  it('a job is retried a bounded number of times', () => {
    expect(MAX_ATTEMPTS).toBe(8)
  })
})
