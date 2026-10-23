// @vitest-environment node
/**
 * AITD-547 — "Repeat every 4 weeks on Friday, from the due date" rolled forward ONE week.
 *
 * A custom weekly pattern never read its interval, on any client (astrid-core docs/CONTRACTS.md
 * D2, reproduced deliberately until web moved). The rule now: a later selected weekday in the
 * same week comes next; past the last one, the series jumps `interval` weeks and takes the first
 * selected weekday of that week. Weeks start on Sunday, the order WEEKDAYS already uses. With an
 * interval of 1 that is exactly the old answer, so every existing weekly series is unchanged.
 */
import { describe, expect, it } from 'vitest'
import { calculateTaskNextOccurrence, type Weekday } from '@/types/repeating'

const LA = 'America/Los_Angeles'

function weekly(interval: number, weekdays: Weekday[]) {
  return { type: 'custom' as const, unit: 'weeks' as const, interval, endCondition: 'never' as const, weekdays }
}

function next(pattern: ReturnType<typeof weekly>, due: string, opts: { completion?: string; repeatFrom?: 'DUE_DATE' | 'COMPLETION_DATE'; timeZone?: string } = {}) {
  return calculateTaskNextOccurrence({
    repeating: 'custom',
    pattern,
    currentDueDate: due,
    completion: opts.completion ?? due,
    repeatFrom: opts.repeatFrom ?? 'DUE_DATE',
    occurrenceCount: 0,
    timeZone: opts.timeZone ?? 'UTC',
    isAllDay: false,
  }).nextDueDate
}

describe('AITD-547: a weekly pattern honours its interval', () => {
  it('every 4 weeks on Friday steps four weeks, not one', () => {
    // Fri 23 Oct 2026 → Fri 20 Nov 2026.
    expect(next(weekly(4, ['friday']), '2026-10-23T09:00:00Z')).toBe('2026-11-20T09:00:00.000Z')
  })

  it('every week on Friday is unchanged', () => {
    expect(next(weekly(1, ['friday']), '2026-10-23T09:00:00Z')).toBe('2026-10-30T09:00:00.000Z')
  })

  it('a later selected day in the same week comes first', () => {
    // Every 4 weeks on Mon and Fri, from Mon 19 Oct: Fri 23 Oct, the same week.
    expect(next(weekly(4, ['monday', 'friday']), '2026-10-19T09:00:00Z')).toBe('2026-10-23T09:00:00.000Z')
  })

  it('past the last selected day, it skips to the first selected day `interval` weeks on', () => {
    // Every 2 weeks on Mon and Wed, from Wed 21 Oct: Mon 2 Nov (the week of 25 Oct is skipped).
    expect(next(weekly(2, ['monday', 'wednesday']), '2026-10-21T09:00:00Z')).toBe('2026-11-02T09:00:00.000Z')
  })

  it('Sunday starts the week', () => {
    // Every 2 weeks on Sunday, from Sun 18 Oct: Sun 1 Nov.
    expect(next(weekly(2, ['sunday']), '2026-10-18T09:00:00Z')).toBe('2026-11-01T09:00:00.000Z')
  })

  it('walks six completions of every 3 weeks on Tue and Thu', () => {
    const pattern = weekly(3, ['tuesday', 'thursday'])
    const dates: string[] = []
    let due = '2026-10-20T09:00:00Z'
    for (let i = 0; i < 6; i++) {
      due = next(pattern, due) as string
      dates.push(due.slice(0, 10))
    }
    expect(dates).toEqual(['2026-10-22', '2026-11-10', '2026-11-12', '2026-12-01', '2026-12-03', '2026-12-22'])
  })

  it('from the completion date, a late completion still lands on the next cycle\'s Friday', () => {
    // Due Fri 23 Oct, completed Sat 24 Oct, every 4 weeks on Friday: Fri 20 Nov.
    const answer = next(weekly(4, ['friday']), '2026-10-23T09:00:00Z', { completion: '2026-10-24T12:00:00Z', repeatFrom: 'COMPLETION_DATE' })
    expect(answer?.slice(0, 10)).toBe('2026-11-20')
  })

  it('keeps 9am on the person\'s calendar across the autumn change, Los Angeles', () => {
    // 9am PDT Fri 23 Oct 2026 → 9am PST Fri 20 Nov 2026.
    expect(next(weekly(4, ['friday']), '2026-10-23T16:00:00Z', { timeZone: LA })).toBe('2026-11-20T17:00:00.000Z')
  })
})
