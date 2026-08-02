/**
 * Regression tests for task 59e2dcff — fold repeating-task completion comments
 * into a streak, and stop depending on English prose to identify them.
 *
 * Mirrors the rules pinned by the iOS/Mac implementation (dd3fda86) so the
 * three clients cannot drift.
 */

import { describe, it, expect } from 'vitest'
import {
  foldCompletionStreaks,
  isCompletionComment,
  describeStreak,
  MIN_STREAK_LENGTH,
} from '@/lib/completion-streak'

let seq = 0
const completion = (overrides: Record<string, unknown> = {}) => ({
  id: `c${seq++}`,
  content: 'Jon Paris marked this as complete',
  authorId: null,
  systemEventType: 'COMPLETED',
  createdAt: new Date('2026-08-01T10:00:00Z'),
  ...overrides,
})
const userComment = (overrides: Record<string, unknown> = {}) => ({
  id: `u${seq++}`,
  content: 'Looks good to me',
  authorId: 'user-1',
  systemEventType: null,
  createdAt: new Date('2026-08-01T11:00:00Z'),
  ...overrides,
})

describe('isCompletionComment (59e2dcff)', () => {
  it('uses the typed discriminator when present', () => {
    expect(isCompletionComment(completion())).toBe(true)
    expect(isCompletionComment(completion({ systemEventType: 'REOPENED' }))).toBe(false)
  })

  it('IGNORES the prose when the typed field says otherwise', () => {
    // The entire point of the field: structure wins over text, so rewording or
    // localising the sentence cannot break the fold.
    const reworded = completion({ content: 'Tarea completada por Jon', systemEventType: 'COMPLETED' })
    expect(isCompletionComment(reworded)).toBe(true)
  })

  it('falls back to the English marker only for untyped legacy comments', () => {
    expect(isCompletionComment(completion({ systemEventType: null }))).toBe(true)
  })

  it('does not mistake a reopen for a completion in the legacy path', () => {
    // "incomplete" contains "complete" — the classic substring trap.
    const reopen = completion({ systemEventType: null, content: 'Jon Paris marked this as incomplete' })
    expect(isCompletionComment(reopen)).toBe(false)
  })

  it('NEVER treats a user comment as a completion, whatever it says', () => {
    const impostor = userComment({ content: 'I marked this as complete yesterday' })
    expect(isCompletionComment(impostor)).toBe(false)
  })
})

describe('foldCompletionStreaks (59e2dcff)', () => {
  it('folds a run of 3 or more into one streak entry', () => {
    const entries = foldCompletionStreaks([completion(), completion(), completion()])
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe('streak')
    expect(entries[0].kind === 'streak' && entries[0].count).toBe(3)
  })

  it('does NOT fold a run of 2 — that hides as much as it saves', () => {
    const entries = foldCompletionStreaks([completion(), completion()])
    expect(entries).toHaveLength(2)
    expect(entries.every(e => e.kind === 'comment')).toBe(true)
  })

  it('leaves a lone completion alone', () => {
    const entries = foldCompletionStreaks([completion()])
    expect(entries).toEqual([{ kind: 'comment', comment: expect.objectContaining({ systemEventType: 'COMPLETED' }) }])
  })

  it('a user comment SPLITS a run', () => {
    // Someone replying mid-streak is a real boundary; folding across it would
    // reorder what the thread means.
    const entries = foldCompletionStreaks([
      completion(), completion(), completion(),
      userComment(),
      completion(), completion(), completion(),
    ])
    expect(entries.map(e => e.kind)).toEqual(['streak', 'comment', 'streak'])
  })

  it('a user comment mid-run can leave both halves too short to fold', () => {
    const entries = foldCompletionStreaks([
      completion(), completion(),
      userComment(),
      completion(), completion(),
    ])
    expect(entries.every(e => e.kind === 'comment')).toBe(true)
    expect(entries).toHaveLength(5)
  })

  it('never folds user comments', () => {
    const entries = foldCompletionStreaks([userComment(), userComment(), userComment(), userComment()])
    expect(entries).toHaveLength(4)
    expect(entries.every(e => e.kind === 'comment')).toBe(true)
  })

  it('a reopen breaks the streak', () => {
    const entries = foldCompletionStreaks([
      completion(), completion(), completion(),
      completion({ systemEventType: 'REOPENED', content: 'Jon Paris marked this as incomplete' }),
      completion(), completion(), completion(),
    ])
    expect(entries.map(e => e.kind)).toEqual(['streak', 'comment', 'streak'])
  })

  it('preserves thread order', () => {
    const first = userComment({ id: 'first' })
    const last = userComment({ id: 'last' })
    const entries = foldCompletionStreaks([first, completion(), completion(), completion(), last])
    expect(entries[0].kind === 'comment' && entries[0].comment.id).toBe('first')
    expect(entries[1].kind).toBe('streak')
    expect(entries[2].kind === 'comment' && entries[2].comment.id).toBe('last')
  })

  it('reports the span the run covers', () => {
    const entries = foldCompletionStreaks([
      completion({ createdAt: new Date('2026-07-01T10:00:00Z') }),
      completion({ createdAt: new Date('2026-07-08T10:00:00Z') }),
      completion({ createdAt: new Date('2026-07-15T10:00:00Z') }),
    ])
    expect(entries[0].kind).toBe('streak')
    if (entries[0].kind === 'streak') {
      expect(entries[0].from.toISOString()).toBe('2026-07-01T10:00:00.000Z')
      expect(entries[0].to.toISOString()).toBe('2026-07-15T10:00:00.000Z')
      // The individual comments stay available so the row can expand.
      expect(entries[0].comments).toHaveLength(3)
    }
  })

  it('accepts ISO strings as well as Dates (API payloads arrive serialized)', () => {
    const entries = foldCompletionStreaks([
      completion({ createdAt: '2026-07-01T10:00:00Z' }),
      completion({ createdAt: '2026-07-08T10:00:00Z' }),
      completion({ createdAt: '2026-07-15T10:00:00Z' }),
    ])
    expect(entries[0].kind).toBe('streak')
  })

  it('handles an empty thread', () => {
    expect(foldCompletionStreaks([])).toEqual([])
  })

  it('MIN_STREAK_LENGTH is 3, matching the iOS rule', () => {
    expect(MIN_STREAK_LENGTH).toBe(3)
  })
})

describe('describeStreak (59e2dcff)', () => {
  it('shows a date range across days', () => {
    const label = describeStreak(7, new Date('2026-07-01T10:00:00Z'), new Date('2026-07-15T10:00:00Z'))
    expect(label).toContain('Completed 7 times')
    expect(label).toContain('–')
  })

  it('collapses to a single date when the run is same-day', () => {
    const label = describeStreak(3, new Date('2026-07-01T10:00:00Z'), new Date('2026-07-01T18:00:00Z'))
    expect(label).toContain('Completed 3 times on')
    expect(label).not.toContain('–')
  })
})
