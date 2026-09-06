/**
 * Task e0613ae5 — the shared `limit` parser.
 *
 * Every case here is one that reached a database `take` before this existed.
 */

import { describe, it, expect } from 'vitest'
import { parseLimit, parseOffset } from '@/lib/pagination'

const opts = { fallback: 10, max: 100 }

describe('parseLimit', () => {
  it('passes a reasonable value through', () => {
    expect(parseLimit('25', opts)).toBe(25)
    expect(parseLimit(25, opts)).toBe(25)
  })

  it('caps a greedy request', () => {
    expect(parseLimit('1000000', opts)).toBe(100)
    expect(parseLimit('101', opts)).toBe(100)
  })

  it('uses the fallback when the parameter is absent', () => {
    expect(parseLimit(null, opts)).toBe(10)
    expect(parseLimit(undefined, opts)).toBe(10)
    expect(parseLimit('', opts)).toBe(10)
  })

  it('never returns NaN, which is the case a cap does not rescue', () => {
    // Math.min(NaN, 100) is NaN, so the obvious implementation passed this
    // straight through to Prisma.
    for (const bad of ['abc', 'ten', '12abc-x', NaN]) {
      const result = parseLimit(bad as never, opts)
      expect(Number.isNaN(result)).toBe(false)
    }
    expect(parseLimit('abc', opts)).toBe(10)
  })

  it('refuses zero and negatives', () => {
    // `take: 0` returns nothing and `take: -5` throws; both read to a caller as
    // "the endpoint is broken".
    expect(parseLimit('0', opts)).toBe(10)
    expect(parseLimit('-5', opts)).toBe(10)
  })

  it('floors a fractional limit rather than passing it on', () => {
    expect(parseLimit(7.9, opts)).toBe(7)
  })

  it('honours a fallback larger than max by clamping it too', () => {
    // Guards against a caller configuring a nonsense pair and getting an
    // over-large default silently.
    expect(parseLimit(null, { fallback: 500, max: 100 })).toBe(100)
  })

  it('tolerates leading and trailing spaces from a hand-typed URL', () => {
    expect(parseLimit(' 25 ', opts)).toBe(25)
  })
})

describe('parseOffset', () => {
  // Zero is both the default and a legitimate value, so this cannot share
  // parseLimit's "collapse to fallback" rule (task 49dcf609).
  it.each([
    ['absent', undefined, 0],
    ['empty', '', 0],
    ['non-numeric', 'abc', 0],
    ['negative', '-5', 0],
    ['zero', '0', 0],
    ['a real offset', '40', 40],
    ['fractional', '7.9', 7],
  ])('maps %s to %i', (_label, raw, expected) => {
    expect(parseOffset(raw as string | undefined)).toBe(expected)
  })

  it('caps an absurd offset', () => {
    expect(parseOffset('999999999')).toBe(1_000_000)
  })
})
