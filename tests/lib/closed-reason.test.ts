/**
 * Regression tests for task 11042ae3 — a terminal state other than "done".
 *
 * Task.completed is a boolean, so "we're not doing this" could only be
 * expressed by deleting the task, destroying the title, the discussion, the
 * decision and any chance of reporting on it.
 */

import { describe, it, expect } from 'vitest'
import {
  parseClosedReason,
  isClosedReason,
  isCanceled,
  toGithubStateReason,
  fromGithubStateReason,
  CLOSED_REASONS,
} from '@/lib/closed-reason'

describe('parseClosedReason (11042ae3)', () => {
  it('accepts every supported reason', () => {
    for (const reason of CLOSED_REASONS) {
      expect(parseClosedReason(reason)).toEqual({ ok: true, value: reason })
    }
  })

  it('treats undefined, null and empty string as "no reason"', () => {
    expect(parseClosedReason(undefined)).toEqual({ ok: true, value: null })
    expect(parseClosedReason(null)).toEqual({ ok: true, value: null })
    expect(parseClosedReason('')).toEqual({ ok: true, value: null })
  })

  it('rejects an unrecognised reason rather than silently nulling it', () => {
    // A typo'd reason must not quietly become "completed normally" — that
    // would lose the very distinction this feature exists to record.
    const result = parseClosedReason('cancelled') // British spelling, not our value
    expect(result.ok).toBe(false)
  })

  it('rejects a non-string', () => {
    expect(parseClosedReason({ evil: true }).ok).toBe(false)
    expect(parseClosedReason(42).ok).toBe(false)
  })
})

describe('isCanceled (11042ae3)', () => {
  it('is true only for a closed task with a reason', () => {
    expect(isCanceled({ completed: true, closedReason: 'canceled' })).toBe(true)
    expect(isCanceled({ completed: true, closedReason: 'duplicate' })).toBe(true)
  })

  it('is false for a normally completed task', () => {
    // The overwhelmingly common case: null reason draws no UI at all.
    expect(isCanceled({ completed: true, closedReason: null })).toBe(false)
    expect(isCanceled({ completed: true })).toBe(false)
  })

  it('is false for an open task, even one carrying a stale reason', () => {
    expect(isCanceled({ completed: false, closedReason: 'canceled' })).toBe(false)
  })

  it('is false for an unrecognised reason', () => {
    expect(isCanceled({ completed: true, closedReason: 'whatever' })).toBe(false)
  })
})

describe('GitHub state_reason mapping (11042ae3)', () => {
  it('maps every one of our reasons to not_planned', () => {
    for (const reason of CLOSED_REASONS) {
      expect(toGithubStateReason(reason)).toBe('not_planned')
    }
  })

  it('maps a normal completion to completed', () => {
    expect(toGithubStateReason(null)).toBe('completed')
    expect(toGithubStateReason(undefined)).toBe('completed')
  })

  it('imports not_planned as canceled — the most general reason we have', () => {
    // GitHub cannot tell us which of our three it was.
    expect(fromGithubStateReason('not_planned')).toBe('canceled')
  })

  it('imports a normal close as no reason', () => {
    expect(fromGithubStateReason('completed')).toBeNull()
    expect(fromGithubStateReason(null)).toBeNull()
  })

  it('round-trips a cancel through GitHub without becoming a normal completion', () => {
    expect(fromGithubStateReason(toGithubStateReason('canceled'))).toBe('canceled')
  })
})

describe('isClosedReason (11042ae3)', () => {
  it('guards the union', () => {
    expect(isClosedReason('canceled')).toBe(true)
    expect(isClosedReason('nope')).toBe(false)
    expect(isClosedReason(null)).toBe(false)
  })
})
