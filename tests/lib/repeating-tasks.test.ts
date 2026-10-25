/**
 * Repeating-task date maths in types/repeating.ts.
 *
 * AWTD-1343 folded the duplicated "BUG FIX: Repeat X Times / Until Date"
 * blocks and the per-pattern "Simple Daily/Weekly/Monthly/Yearly … end
 * condition" blocks into tables. Every distinct case is a row below: the
 * end-condition checks never depended on the pattern label (the helper does
 * not take one), and the custom-pattern occurrence limit was asserted three
 * times over for endAfterOccurrences=3.
 */
import { describe, it, expect } from 'vitest'
import {
  calculateSimpleRepeatingNextOccurrence,
  calculateNextOccurrence,
  checkSimplePatternEndCondition
} from '@/types/repeating'
import type { CustomRepeatingPattern } from '@/types/repeating'

type Simple = Parameters<typeof calculateSimpleRepeatingNextOccurrence>[0]
type Mode = Parameters<typeof calculateSimpleRepeatingNextOccurrence>[3]

const d = (iso: string) => new Date(iso)

describe('Repeating Tasks', () => {
  describe('Simple patterns — next occurrence keeps the due time (UTC)', () => {
    // `expect` lists the UTC fields of the next date; hours/minutes default to
    // the due date's own, which is the time-preservation guarantee.
    const rows: Array<{
      name: string
      pattern: Simple
      due: string
      completion: string
      mode: Mode
      expect?: { date?: number; hours?: number; month?: number; year?: number }
      /** COMPLETION_DATE: next UTC date = completion + this many days */
      daysAfterCompletion?: number
    }> = [
      // DUE_DATE mode — also covers the old "DST transition" case (Nov 1, daily), which asserted the same thing.
      { name: 'daily from due date', pattern: 'daily', due: '2025-11-01T14:30:00.000Z', completion: '2025-11-15T18:00:00.000Z', mode: 'DUE_DATE' },
      { name: 'weekly from due date', pattern: 'weekly', due: '2025-11-01T14:30:00.000Z', completion: '2025-11-15T17:00:00.000Z', mode: 'DUE_DATE' },
      { name: 'monthly from due date advances the month', pattern: 'monthly', due: '2025-11-15T10:30:00.000Z', completion: '2025-11-20T18:00:00.000Z', mode: 'DUE_DATE', expect: { month: 11 } },
      { name: 'yearly from due date advances the year', pattern: 'yearly', due: '2025-11-15T15:45:00.000Z', completion: '2025-11-20T18:00:00.000Z', mode: 'DUE_DATE', expect: { year: 2026 } },
      // COMPLETION_DATE mode — time from the due date, day from the completion.
      { name: 'daily from completion', pattern: 'daily', due: '2025-11-01T09:00:00.000Z', completion: '2025-11-15T18:00:00.000Z', mode: 'COMPLETION_DATE', daysAfterCompletion: 1 },
      { name: 'weekly from completion', pattern: 'weekly', due: '2025-11-01T14:30:00.000Z', completion: '2025-11-15T20:00:00.000Z', mode: 'COMPLETION_DATE', daysAfterCompletion: 7 },
      // BUG FIX: evening time zone edge case. Completing a daily task due at
      // 7pm PT created the next one the day after tomorrow: local date methods
      // were applied to an anchor set with UTC methods, so a due time past UTC
      // midnight was counted twice.
      { name: 'daily due in the evening (7pm PT = 3am UTC next day)', pattern: 'daily', due: '2026-01-06T03:00:00.000Z', completion: '2026-01-06T04:00:00.000Z', mode: 'COMPLETION_DATE', expect: { date: 7, hours: 3, month: 0 } },
      { name: 'daily completed near UTC midnight (11pm PT)', pattern: 'daily', due: '2026-01-06T07:00:00.000Z', completion: '2026-01-06T07:30:00.000Z', mode: 'COMPLETION_DATE', expect: { date: 7, hours: 7 } },
      { name: 'weekly due in the evening', pattern: 'weekly', due: '2026-01-06T03:00:00.000Z', completion: '2026-01-06T04:00:00.000Z', mode: 'COMPLETION_DATE', expect: { date: 13, hours: 3 } },
      { name: 'DUE_DATE mode for an evening task completed days later', pattern: 'daily', due: '2026-01-06T03:00:00.000Z', completion: '2026-01-08T04:00:00.000Z', mode: 'DUE_DATE', expect: { date: 7, hours: 3 } },
      { name: 'monthly crossing the UTC day boundary', pattern: 'monthly', due: '2026-01-16T06:00:00.000Z', completion: '2026-01-16T07:00:00.000Z', mode: 'COMPLETION_DATE', expect: { month: 1, date: 16, hours: 6 } },
    ]

    it.each(rows)('$name', row => {
      const due = d(row.due)
      const completion = d(row.completion)
      const next = calculateSimpleRepeatingNextOccurrence(row.pattern, due, completion, row.mode)

      expect(next.getUTCHours()).toBe(row.expect?.hours ?? due.getUTCHours())
      expect(next.getUTCMinutes()).toBe(due.getUTCMinutes())
      expect(next.getUTCSeconds()).toBe(due.getUTCSeconds())
      if (row.expect?.date !== undefined) expect(next.getUTCDate()).toBe(row.expect.date)
      if (row.expect?.month !== undefined) expect(next.getUTCMonth()).toBe(row.expect.month)
      if (row.expect?.year !== undefined) expect(next.getUTCFullYear()).toBe(row.expect.year)
      if (row.daysAfterCompletion !== undefined) {
        const expected = new Date(completion)
        expected.setUTCDate(expected.getUTCDate() + row.daysAfterCompletion)
        expect(next.getUTCDate()).toBe(expected.getUTCDate())
      }
    })

    it('clamps month-end (Jan 31 -> Feb 28)', () => {
      const dueDate = d('2025-01-31T10:00:00.000Z')
      const nextDate = calculateSimpleRepeatingNextOccurrence('monthly', dueDate, d('2025-01-31T18:00:00.000Z'), 'DUE_DATE')

      // 2025 is not a leap year
      expect(nextDate.getMonth()).toBe(1)
      expect(nextDate.getDate()).toBe(28)
      expect(nextDate.getHours()).toBe(dueDate.getHours())
    })

    it('falls back to the completion date when there is no due date', () => {
      const completionDate = d('2025-11-15T18:00:00.000Z')
      const nextDate = calculateSimpleRepeatingNextOccurrence('daily', null, completionDate, 'DUE_DATE')
      expect(nextDate.getDate()).toBe(completionDate.getDate() + 1)
    })
  })

  describe('Custom patterns', () => {
    type End = Partial<Pick<CustomRepeatingPattern, 'interval' | 'endCondition' | 'endAfterOccurrences' | 'endUntilDate'>>
    const daily = (extra: End = {}): CustomRepeatingPattern => ({
      type: 'custom', unit: 'days', interval: 1, endCondition: 'never', ...extra,
    })
    const weeklyMonday = (extra: End = {}): CustomRepeatingPattern => ({
      type: 'custom', unit: 'weeks', interval: 1, weekdays: ['monday'], endCondition: 'never', ...extra,
    })

    it('preserves the time when repeating every 2 days from the due date', () => {
      const dueDate = d('2025-11-10T14:30:00.000Z') // after the DST transition
      const result = calculateNextOccurrence(daily({ interval: 2 }), dueDate, d('2025-11-15T18:00:00.000Z'), 'DUE_DATE', 0)

      expect(result.shouldTerminate).toBe(false)
      expect(result.nextDueDate).toBeDefined()
      expect(result.nextDueDate!.getHours()).toBe(dueDate.getHours())
      expect(result.nextDueDate!.getMinutes()).toBe(dueDate.getMinutes())
    })

    it('increments the occurrence count', () => {
      const result = calculateNextOccurrence(daily(), d('2025-11-01T10:00:00.000Z'), d('2025-11-15T18:00:00.000Z'), 'DUE_DATE', 5)
      expect(result.newOccurrenceCount).toBe(6)
    })

    // BUG FIX: Repeat X Times. endAfterOccurrences = N means N completions in
    // total: the count goes 0 → 1 … N, and the completion that reaches N ends
    // the series. Occurrence count is not "repetitions after the first".
    describe.each([
      { name: 'daily, endAfterOccurrences=1 (single occurrence)', pattern: daily, n: 1, due: '2025-11-01T10:00:00.000Z' },
      { name: 'daily, endAfterOccurrences=3', pattern: daily, n: 3, due: '2025-11-01T10:00:00.000Z' },
      { name: 'daily, endAfterOccurrences=5', pattern: daily, n: 5, due: '2025-11-01T10:00:00.000Z' },
      { name: 'weekly Monday, endAfterOccurrences=2', pattern: weeklyMonday, n: 2, due: '2025-11-03T10:00:00.000Z' },
    ])('Repeat X Times — $name', ({ pattern, n, due }) => {
      const p = pattern({ endCondition: 'after_occurrences', endAfterOccurrences: n })
      const completion = new Date(new Date(due).getTime() + 8 * 3600_000)

      it.each(Array.from({ length: n }, (_, i) => i))('completion with count %i', count => {
        const result = calculateNextOccurrence(p, d(due), completion, 'DUE_DATE', count)
        const last = count === n - 1
        expect(result.shouldTerminate).toBe(last)
        expect(result.newOccurrenceCount).toBe(count + 1)
        if (last) expect(result.nextDueDate).toBe(null)
        else expect(result.nextDueDate).toBeDefined()
      })
    })

    // BUG FIX: Repeat Until Date. The end date is inclusive by day — an
    // occurrence ON the end date still happens; one after it ends the series.
    it.each([
      { name: 'daily: next (Nov 30) before the end date continues', pattern: daily, end: '2025-12-01T00:00:00.000Z', due: '2025-11-29T10:00:00.000Z', count: 0, terminate: false },
      { name: 'daily: next (Dec 1 10:00) on the end day continues', pattern: daily, end: '2025-12-01T00:00:00.000Z', due: '2025-11-30T10:00:00.000Z', count: 1, terminate: false },
      { name: 'daily: next (Dec 2) after the end date terminates', pattern: daily, end: '2025-12-01T00:00:00.000Z', due: '2025-12-01T10:00:00.000Z', count: 30, terminate: true },
      { name: 'daily: next equal to the end instant continues', pattern: daily, end: '2025-12-01T10:00:00.000Z', due: '2025-11-30T10:00:00.000Z', count: 0, terminate: false },
      { name: 'daily: next well before the end lands on Dec 1', pattern: daily, end: '2025-12-05T23:59:59.000Z', due: '2025-11-30T10:00:00.000Z', count: 0, terminate: false, nextUtc: { date: 1, month: 11 } },
      { name: 'weekly Monday: next (Dec 15) on the end date continues', pattern: weeklyMonday, end: '2025-12-15T00:00:00.000Z', due: '2025-12-08T10:00:00.000Z', count: 0, terminate: false },
      { name: 'weekly Monday: next (Dec 22) after the end date terminates', pattern: weeklyMonday, end: '2025-12-15T00:00:00.000Z', due: '2025-12-15T10:00:00.000Z', count: 1, terminate: true },
    ])('Repeat Until Date — $name', ({ pattern, end, due, count, terminate, nextUtc }) => {
      const p = pattern({ endCondition: 'until_date', endUntilDate: d(end) })
      const completion = new Date(new Date(due).getTime() + 8 * 3600_000)
      const result = calculateNextOccurrence(p, d(due), completion, 'DUE_DATE', count)

      expect(result.shouldTerminate).toBe(terminate)
      if (terminate) {
        expect(result.nextDueDate).toBe(null)
      } else {
        expect(result.nextDueDate).toBeDefined()
        if (nextUtc) {
          expect(result.nextDueDate!.getUTCDate()).toBe(nextUtc.date)
          expect(result.nextDueDate!.getUTCMonth()).toBe(nextUtc.month)
        }
      }
    })
  })

  // BUG FIX: simple (non-custom) patterns ignored their end conditions. The
  // check takes no pattern, so the old daily/weekly/monthly/yearly variants
  // were the same assertions on different dates.
  describe('checkSimplePatternEndCondition', () => {
    it.each([
      ...[1, 2, 3].map(count => ({ n: 3, count })),
      ...[1, 2, 3, 4, 5].map(count => ({ n: 5, count })),
    ])('after_occurrences=$n: count $count', ({ n, count }) => {
      const result = checkSimplePatternEndCondition(d('2026-01-01T10:00:00.000Z'), count, {
        endCondition: 'after_occurrences', endAfterOccurrences: n,
      })
      expect(result.shouldTerminate).toBe(count === n)
      expect(result.newOccurrenceCount).toBe(count)
    })

    it.each([
      { name: 'weekly-scale: before the end date', end: '2025-12-15T00:00:00.000Z', next: '2025-12-10T10:00:00.000Z', terminate: false },
      { name: 'weekly-scale: on the end date', end: '2025-12-15T00:00:00.000Z', next: '2025-12-15T10:00:00.000Z', terminate: false },
      { name: 'weekly-scale: after the end date', end: '2025-12-15T00:00:00.000Z', next: '2025-12-20T10:00:00.000Z', terminate: true },
      { name: 'yearly-scale: before the end date', end: '2030-01-01T00:00:00.000Z', next: '2029-01-01T10:00:00.000Z', terminate: false },
      { name: 'yearly-scale: on the end date', end: '2030-01-01T00:00:00.000Z', next: '2030-01-01T10:00:00.000Z', terminate: false },
      { name: 'yearly-scale: after the end date', end: '2030-01-01T00:00:00.000Z', next: '2031-01-01T10:00:00.000Z', terminate: true },
    ])('until_date — $name', ({ end, next, terminate }) => {
      const result = checkSimplePatternEndCondition(d(next), 1, { endCondition: 'until_date', endUntilDate: d(end) })
      expect(result.shouldTerminate).toBe(terminate)
    })

    it.each([
      { name: 'endCondition "never"', endData: { endCondition: 'never' as const } },
      { name: 'no end data', endData: null },
    ])('never terminates with $name', ({ endData }) => {
      const result = checkSimplePatternEndCondition(d('2099-12-31T10:00:00.000Z'), 999, endData)
      expect(result.shouldTerminate).toBe(false)
      expect(result.newOccurrenceCount).toBe(999)
    })
  })
})
