/**
 * Two-phase waking bookkeeping for the scheduled /fixall loop (AWTD-986).
 *
 * The preflight hands the run its wake keys; how the run ends decides what
 * the seen-file learns. A finished run mutes its keys. A failed run gives
 * them a strike, and a key out of strikes is muted too — the alternative
 * is a run that keeps dying on one item waking a session every tick.
 */
import { describe, it, expect } from 'vitest'
import {
  MAX_FAILED_ATTEMPTS,
  parseSeenKeys,
  recordFailedRun,
  recordFinishedRun,
} from '../../scripts/lib/wake-keys'

describe('parseSeenKeys (AWTD-986)', () => {
  it('reads a JSON array of strings and drops anything else', () => {
    expect(parseSeenKeys('["comment:a:1", 7, "message:b"]')).toEqual(['comment:a:1', 'message:b'])
  })

  it('returns null, not an empty list, for missing or malformed input', () => {
    // Null is "record nothing"; an empty list would be "record an empty
    // set", which un-mutes every key the file already held.
    expect(parseSeenKeys(undefined)).toBeNull()
    expect(parseSeenKeys('')).toBeNull()
    expect(parseSeenKeys('{"not":"an array"}')).toBeNull()
    expect(parseSeenKeys('not json')).toBeNull()
  })
})

describe('recordFinishedRun (AWTD-986)', () => {
  it('merges the keys into the seen set rather than replacing it', () => {
    // A preflight whose inbox could not be read carries no comment keys;
    // replacing the file with what it had would un-mute the old ones.
    const out = recordFinishedRun(['comment:old:1'], ['review:t1:none'], {})
    expect(out.seen.sort()).toEqual(['comment:old:1', 'review:t1:none'])
  })

  it('clears the strikes of keys whose run finished', () => {
    const out = recordFinishedRun([], ['a'], { a: 1, b: 1 })
    expect(out.attempts).toEqual({ b: 1 })
  })
})

describe('recordFailedRun (AWTD-986)', () => {
  it('gives each key a strike and does not mute it on the first failure', () => {
    const out = recordFailedRun(['muted'], ['a', 'b'], {})
    expect(out.attempts).toEqual({ a: 1, b: 1 })
    expect(out.exhausted).toEqual([])
    expect(out.seen).toEqual(['muted'])
  })

  it(`mutes a key after ${MAX_FAILED_ATTEMPTS} failed runs and forgets its strikes`, () => {
    let attempts: Record<string, number> = {}
    let seen: string[] = []
    let exhausted: string[] = []
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      ;({ attempts, seen, exhausted } = recordFailedRun(seen, ['a'], attempts))
    }
    expect(exhausted).toEqual(['a'])
    expect(seen).toEqual(['a'])
    expect(attempts).toEqual({})
  })

  it('keeps the limit small: a repeatedly failing item costs a couple of runs, not a day of them', () => {
    expect(MAX_FAILED_ATTEMPTS).toBeLessThanOrEqual(3)
  })
})
