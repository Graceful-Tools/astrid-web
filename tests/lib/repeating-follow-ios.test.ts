// @vitest-environment node
/**
 * AWTD-1063 — web's rollover follows iOS (astrid-core docs/CONTRACTS.md D1, D3, D4; decided
 * 2026-10-03). Before this, the server stepped every series on UTC's calendar. The Apple apps
 * step a timed task on the person's own calendar, and they ask astrid-core to do it. Web now
 * gives the same answers. These are the cases where users see a different date than before.
 *
 * Each expected value here is astrid-core's answer, the one iOS and the Mac show. The shared
 * fixture (contracts/fixtures/repeating.json `completions`) locks the full set. This file names
 * the user-visible changes one at a time so a regression reads as a sentence.
 */
import { describe, expect, it } from 'vitest'
import { calculateTaskNextOccurrence, type TaskNextOccurrenceInput } from '@/types/repeating'

const LA = 'America/Los_Angeles'

function next(input: Partial<TaskNextOccurrenceInput> & Pick<TaskNextOccurrenceInput, 'repeating'>) {
  return calculateTaskNextOccurrence({
    pattern: null,
    currentDueDate: null,
    completion: input.currentDueDate ?? '2026-01-01T00:00:00Z',
    repeatFrom: 'DUE_DATE',
    occurrenceCount: 0,
    timeZone: 'UTC',
    isAllDay: false,
    ...input,
  })
}

describe('D1: a timed task steps on the person’s calendar', () => {
  it('keeps 9am at 9am across the spring daylight-saving change', () => {
    // 9am PST on Sat 7 March 2026. Sunday 8 March is PDT. Before: 10am PDT (UTC +24h).
    expect(next({ repeating: 'daily', currentDueDate: '2026-03-07T17:00:00Z', timeZone: LA }).nextDueDate)
      .toBe('2026-03-08T16:00:00.000Z')
  })

  it('keeps "monthly at 2pm" at 2pm when the month crosses the change', () => {
    expect(next({ repeating: 'monthly', currentDueDate: '2026-02-15T22:00:00Z', timeZone: LA }).nextDueDate)
      .toBe('2026-03-15T21:00:00.000Z')
  })

  it('anchors an evening completion on the person’s day, not the next UTC day', () => {
    // A 9am daily task, repeating from completion, ticked off at 6pm on 5 January in LA
    // (02:00 UTC on the 6th). Before: due 7 January. Now: 6 January, as on iOS.
    const input = {
      repeating: 'daily' as const,
      repeatFrom: 'COMPLETION_DATE' as const,
      currentDueDate: '2026-01-05T17:00:00Z',
      completion: '2026-01-06T02:00:00Z',
    }
    expect(next({ ...input, timeZone: LA }).nextDueDate).toBe('2026-01-06T17:00:00.000Z')
    // Without a zone the server keeps its old UTC answer.
    expect(next(input).nextDueDate).toBe('2026-01-07T17:00:00.000Z')
  })

  it('reads "repeat until" as the person’s date', () => {
    // The web date picker stores Paris midnight on 15 December as 23:00 UTC on the 14th. Before,
    // that read as the 14th, so the occurrence on the 15th was dropped.
    const result = next({
      repeating: 'daily',
      pattern: { endCondition: 'until_date', endUntilDate: '2026-12-14T23:00:00.000Z' },
      currentDueDate: '2026-12-14T09:00:00Z',
      timeZone: 'Europe/Paris',
    })
    expect(result).toEqual({ nextDueDate: '2026-12-15T09:00:00.000Z', shouldTerminate: false, newOccurrenceCount: 1 })
  })

  it('still steps an all-day task on UTC’s calendar, wherever the person is', () => {
    expect(next({ repeating: 'daily', isAllDay: true, currentDueDate: '2026-03-07T00:00:00Z', timeZone: LA }).nextDueDate)
      .toBe('2026-03-08T00:00:00.000Z')
  })
})

describe('D3: "the third Tuesday" is a Tuesday where the person lives', () => {
  it('lands on local midnight of the third Tuesday, not UTC midnight (a Monday evening in LA)', () => {
    const result = next({
      repeating: 'custom',
      pattern: {
        type: 'custom', unit: 'months', interval: 1, endCondition: 'never',
        monthRepeatType: 'same_weekday', monthWeekday: { weekday: 'tuesday', weekOfMonth: 3 },
      },
      currentDueDate: '2026-01-20T18:00:00Z',
      timeZone: LA,
    })
    expect(result.nextDueDate).toBe('2026-02-17T08:00:00.000Z')
  })
})

describe('D4: a custom pattern no longer depends on the machine’s zone', () => {
  it('picks the next selected weekday on the person’s calendar (Mon 8am in Tokyo is Sunday in UTC)', () => {
    const result = next({
      repeating: 'custom',
      pattern: { type: 'custom', unit: 'weeks', interval: 1, endCondition: 'never', weekdays: ['monday', 'wednesday', 'friday'] },
      currentDueDate: '2026-01-04T23:00:00Z',
      timeZone: 'Asia/Tokyo',
    })
    // Wednesday 8am in Tokyo. Before: Tuesday 8am (the UTC Monday after a UTC Sunday).
    expect(result.nextDueDate).toBe('2026-01-06T23:00:00.000Z')
  })
})

describe('clock edges, as the core takes them', () => {
  it('moves a time the spring change skips an hour later', () => {
    expect(next({ repeating: 'daily', currentDueDate: '2026-03-07T10:30:00Z', timeZone: LA }).nextDueDate)
      .toBe('2026-03-08T10:30:00.000Z')
  })

  it('takes the first of a time the autumn change repeats', () => {
    expect(next({ repeating: 'daily', currentDueDate: '2026-10-31T08:30:00Z', timeZone: LA }).nextDueDate)
      .toBe('2026-11-01T08:30:00.000Z')
  })

  it('handles a half-hour daylight-saving shift', () => {
    expect(next({ repeating: 'monthly', currentDueDate: '2026-03-10T00:00:00Z', timeZone: 'Australia/Lord_Howe' }).nextDueDate)
      .toBe('2026-04-10T00:30:00.000Z')
  })
})

describe('patterns old web read differently from the core (no zone involved)', () => {
  it('ends a series whose limit is 0 occurrences', () => {
    expect(next({ repeating: 'daily', pattern: { endCondition: 'after_occurrences', endAfterOccurrences: 0 }, currentDueDate: '2026-01-05T09:00:00Z' }))
      .toEqual({ nextDueDate: null, shouldTerminate: true, newOccurrenceCount: 1 })
  })

  it('puts a yearly "10 February" on 10 February, from a 31st', () => {
    const result = next({
      repeating: 'custom',
      pattern: { type: 'custom', unit: 'years', interval: 1, endCondition: 'never', month: 2, day: 10 },
      currentDueDate: '2026-01-31T09:00:00Z',
    })
    expect(result.nextDueDate).toBe('2027-02-10T09:00:00.000Z')
  })

  it('keeps a same-date monthly pattern that never stored its day', () => {
    const result = next({
      repeating: 'custom',
      pattern: { type: 'custom', unit: 'months', interval: 1, endCondition: 'never', monthRepeatType: 'same_date' },
      currentDueDate: '2026-01-15T09:00:00Z',
    })
    expect(result.nextDueDate).toBe('2026-02-15T09:00:00.000Z')
  })

  it('ends a custom series with no interval', () => {
    expect(next({ repeating: 'custom', pattern: { type: 'custom', unit: 'days', endCondition: 'never' }, currentDueDate: '2026-01-05T09:00:00Z' }))
      .toEqual({ nextDueDate: null, shouldTerminate: true, newOccurrenceCount: 1 })
  })
})
