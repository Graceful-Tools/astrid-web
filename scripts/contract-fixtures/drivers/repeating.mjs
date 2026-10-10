// Runs astrid-web's repeating-task calculator over a fixed case list and prints the results as
// JSON. Invoked by scripts/export-contract-fixtures.ts; not useful on its own.
//
// The web module is imported and EXECUTED rather than parsed. Repeating rollover is arithmetic, not
// a table, so the only honest way to lock it is to run the canonical implementation and record what
// it actually returns. Node runs the TypeScript directly — `types/repeating.ts` imports nothing, so
// no build step and no astrid-web dependencies are involved.
//
// TZ MATTERS HERE. Web's simple patterns use UTC methods, but its custom patterns use local ones
// (`setMonth`, `getDay`, `new Date(y, m, 1)`), so their results depend on the machine's timezone —
// see astrid-core docs/CONTRACTS.md D4. The parent process pins TZ=UTC so the fixture records one defined
// behaviour instead of whichever zone the generating machine happened to be in.
//
// Usage: node scripts/contract-fixtures/drivers/repeating.mjs <path-to-astrid-web>

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/repeating.mjs <path-to-astrid-web>')
  process.exit(2)
}

const repeating = await import(pathToFileURL(join(webRoot, 'types/repeating.ts')).href)
const { calculateSimpleRepeatingNextOccurrence, checkSimplePatternEndCondition, calculateNextOccurrence } = repeating

const iso = (date) => (date === null || date === undefined ? null : new Date(date).toISOString())
const d = (text) => new Date(text)

// Patterns reused across cases.
const WEEKLY_MWF = {
  type: 'custom',
  unit: 'weeks',
  interval: 1,
  endCondition: 'never',
  weekdays: ['monday', 'wednesday', 'friday'],
}
const MONTHLY_15TH = {
  type: 'custom',
  unit: 'months',
  interval: 1,
  endCondition: 'never',
  monthRepeatType: 'same_date',
  monthDay: 15,
}
const THIRD_TUESDAY = {
  type: 'custom',
  unit: 'months',
  interval: 1,
  endCondition: 'never',
  monthRepeatType: 'same_weekday',
  monthWeekday: { weekday: 'tuesday', weekOfMonth: 3 },
}

// Simple patterns: the four types, both repeat modes, plus the edges that have bitten before.
const simpleCases = [
  ['daily from the due date', 'daily', '2024-01-15T10:30:00Z', '2024-01-15T14:00:00Z', 'DUE_DATE'],
  ['daily from a late completion', 'daily', '2024-01-15T10:30:00Z', '2024-01-17T14:00:00Z', 'COMPLETION_DATE'],
  ['weekly from the due date', 'weekly', '2024-01-15T09:00:00Z', '2024-01-15T10:00:00Z', 'DUE_DATE'],
  ['weekly from a late completion', 'weekly', '2024-01-15T09:00:00Z', '2024-01-18T10:00:00Z', 'COMPLETION_DATE'],
  ['monthly from the due date', 'monthly', '2024-01-15T14:00:00Z', '2024-01-15T16:00:00Z', 'DUE_DATE'],
  ['monthly clamps at the end of February', 'monthly', '2024-01-31T09:00:00Z', '2024-01-31T10:00:00Z', 'DUE_DATE'],
  ['monthly clamps in a non-leap year', 'monthly', '2023-01-31T09:00:00Z', '2023-01-31T10:00:00Z', 'DUE_DATE'],
  ['monthly from a late completion', 'monthly', '2024-01-15T14:00:00Z', '2024-01-20T16:00:00Z', 'COMPLETION_DATE'],
  ['yearly from the due date', 'yearly', '2024-06-15T12:00:00Z', '2024-06-15T14:00:00Z', 'DUE_DATE'],
  ['yearly across a leap day', 'yearly', '2024-02-29T09:00:00Z', '2024-02-29T09:00:00Z', 'DUE_DATE'],
  ['an all-day task stays at UTC midnight', 'daily', '2024-01-15T00:00:00Z', '2024-01-15T19:30:00Z', 'COMPLETION_DATE'],
  ['an evening task completed after UTC midnight', 'daily', '2024-01-15T23:30:00Z', '2024-01-16T00:30:00Z', 'DUE_DATE'],
  ['with no due date the completion is the anchor', 'daily', null, '2024-03-10T08:00:00Z', 'DUE_DATE'],
]

const simple = simpleCases.map(([name, type, due, completion, repeatFrom]) => ({
  name,
  repeatingType: type,
  currentDueDate: due,
  completionDate: completion,
  repeatFrom,
  nextDueDate: iso(
    calculateSimpleRepeatingNextOccurrence(type, due ? d(due) : null, d(completion), repeatFrom),
  ),
}))

// The end-condition check, which web keeps separate from the arithmetic above.
const endConditionCases = [
  ['never, even with a limit left over from an earlier edit', '2024-01-16T09:00:00Z', 99, { endCondition: 'never', endAfterOccurrences: 2, endUntilDate: '2020-01-01T00:00:00Z' }],
  ['below the occurrence limit', '2024-01-16T09:00:00Z', 2, { endCondition: 'after_occurrences', endAfterOccurrences: 3 }],
  ['at the occurrence limit', '2024-01-16T09:00:00Z', 3, { endCondition: 'after_occurrences', endAfterOccurrences: 3 }],
  ['past the occurrence limit', '2024-01-16T09:00:00Z', 4, { endCondition: 'after_occurrences', endAfterOccurrences: 3 }],
  ['a limit of none never terminates', '2024-01-16T09:00:00Z', 99, { endCondition: 'after_occurrences' }],
  ['on the end date, which still runs', '2024-01-16T23:00:00Z', 1, { endCondition: 'until_date', endUntilDate: '2024-01-16T00:00:00Z' }],
  ['a day past the end date', '2024-01-17T00:30:00Z', 1, { endCondition: 'until_date', endUntilDate: '2024-01-16T23:59:00Z' }],
  ['before the end date', '2024-01-10T09:00:00Z', 1, { endCondition: 'until_date', endUntilDate: '2024-01-16T00:00:00Z' }],
]

const simpleEndConditions = endConditionCases.map(([name, next, count, endData]) => {
  const result = checkSimplePatternEndCondition(d(next), count, {
    ...endData,
    endUntilDate: endData.endUntilDate ? d(endData.endUntilDate) : undefined,
  })
  return {
    name,
    nextDueDate: next,
    newOccurrenceCount: count,
    endData,
    shouldTerminate: result.shouldTerminate,
    resultOccurrenceCount: result.newOccurrenceCount,
  }
})

// Custom patterns, single step.
const customCases = [
  ['every three days', { type: 'custom', unit: 'days', interval: 3, endCondition: 'never' }, '2024-01-15T09:00:00Z', 'DUE_DATE', 0],
  ['weekly on Mon/Wed/Fri, starting Monday', WEEKLY_MWF, '2024-01-15T09:00:00Z', 'DUE_DATE', 0],
  ['weekly on a single day wraps a whole week', { type: 'custom', unit: 'weeks', interval: 1, endCondition: 'never', weekdays: ['monday'] }, '2024-01-15T09:00:00Z', 'DUE_DATE', 0],
  ['monthly on the 15th', MONTHLY_15TH, '2024-01-15T14:00:00Z', 'DUE_DATE', 0],
  // A custom monthly pattern anchored on the 31st. Web's SIMPLE monthly step clamps explicitly;
  // this custom one does not, so the two disagree about the same question — and a client that
  // clamps here would schedule a different date than the server's own arithmetic produces.
  ['monthly on the 31st, into a short month', { type: 'custom', unit: 'months', interval: 1, endCondition: 'never', monthRepeatType: 'same_date', monthDay: 31 }, '2024-01-31T09:00:00Z', 'DUE_DATE', 0],
  ['monthly on the 30th, into February', { type: 'custom', unit: 'months', interval: 1, endCondition: 'never', monthRepeatType: 'same_date', monthDay: 30 }, '2024-01-30T09:00:00Z', 'DUE_DATE', 0],
  ['the third Tuesday', THIRD_TUESDAY, '2024-01-16T10:00:00Z', 'DUE_DATE', 0],
  // A fifth weekday can fall on the 29th, 30th or 31st, so the intermediate "same day next month"
  // step can overflow before the weekday is even looked for. Dec 29 2024 is the fifth Sunday.
  ['the fifth Sunday, from a 29th', { type: 'custom', unit: 'months', interval: 1, endCondition: 'never', monthRepeatType: 'same_weekday', monthWeekday: { weekday: 'sunday', weekOfMonth: 5 } }, '2024-12-29T10:00:00Z', 'DUE_DATE', 0],
  ['the first Monday, from a 31st', { type: 'custom', unit: 'months', interval: 1, endCondition: 'never', monthRepeatType: 'same_weekday', monthWeekday: { weekday: 'monday', weekOfMonth: 1 } }, '2024-01-31T10:00:00Z', 'DUE_DATE', 0],
  ['every two years on a set month and day', { type: 'custom', unit: 'years', interval: 2, endCondition: 'never', month: 3, day: 10 }, '2024-06-15T12:00:00Z', 'DUE_DATE', 0],
  ['terminating exactly at the occurrence limit', { ...WEEKLY_MWF, endCondition: 'after_occurrences', endAfterOccurrences: 4 }, '2024-01-15T09:00:00Z', 'DUE_DATE', 3],
  ['one occurrence short of the limit', { ...WEEKLY_MWF, endCondition: 'after_occurrences', endAfterOccurrences: 4 }, '2024-01-15T09:00:00Z', 'DUE_DATE', 2],
  ['stopping once past the until date', { ...WEEKLY_MWF, endCondition: 'until_date', endUntilDate: '2024-01-16T00:00:00Z' }, '2024-01-15T09:00:00Z', 'DUE_DATE', 0],
  ['running on the until date itself', { ...WEEKLY_MWF, endCondition: 'until_date', endUntilDate: '2024-01-17T00:00:00Z' }, '2024-01-15T09:00:00Z', 'DUE_DATE', 0],
]

const custom = customCases.map(([name, pattern, due, repeatFrom, count]) => {
  const runnable = {
    ...pattern,
    endUntilDate: pattern.endUntilDate ? d(pattern.endUntilDate) : undefined,
  }
  const result = calculateNextOccurrence(runnable, d(due), d(due), repeatFrom, count)
  return {
    name,
    pattern,
    currentDueDate: due,
    completionDate: due,
    repeatFrom,
    currentOccurrenceCount: count,
    nextDueDate: iso(result.nextDueDate),
    shouldTerminate: result.shouldTerminate,
    newOccurrenceCount: result.newOccurrenceCount,
  }
})

// Multi-step progressions. Single-step tests routinely miss what these catch: the weekly M/W/F bug
// that prompted all of this only shows up once you walk several completions.
const progressionCases = [
  ['weekly on Mon/Wed/Fri from the due date', WEEKLY_MWF, '2024-01-15T09:00:00Z', 'DUE_DATE', 6],
  ['weekly on Mon/Wed/Fri from the completion date', WEEKLY_MWF, '2024-01-15T09:00:00Z', 'COMPLETION_DATE', 6],
  ['monthly on the 15th, through a year', MONTHLY_15TH, '2024-01-15T14:00:00Z', 'DUE_DATE', 12],
  ['the third Tuesday, through six months', THIRD_TUESDAY, '2024-01-16T10:00:00Z', 'DUE_DATE', 6],
  ['every three days, through a month boundary', { type: 'custom', unit: 'days', interval: 3, endCondition: 'never' }, '2024-01-25T09:00:00Z', 'DUE_DATE', 5],
]

const customProgressions = progressionCases.map(([name, pattern, start, repeatFrom, steps]) => {
  const dates = []
  let current = d(start)
  let occurrences = 0
  for (let i = 0; i < steps; i++) {
    // Each completion happens exactly on the due date, which is the shape a user who keeps up with
    // a repeating task actually produces.
    const result = calculateNextOccurrence(pattern, current, current, repeatFrom, occurrences)
    if (!result.nextDueDate) break
    dates.push(result.nextDueDate.toISOString())
    current = result.nextDueDate
    occurrences = result.newOccurrenceCount
    if (result.shouldTerminate) break
  }
  return { name, pattern, start, repeatFrom, steps, dates }
})

// The whole rule, as a server asks it: astrid-core's `nextOccurrence` request — a task's repeat
// fields, the instant it was completed and the person's zone — and its answer. This is what
// lib/repeating-rollover.ts sends the core and what the TypeScript fallback answers (AWTD-1063).
//
// The zoned cases are where web followed iOS on 2026-10-03 (astrid-core docs/CONTRACTS.md D1, D3,
// D4): a timed task steps on the person's calendar, an all-day one on UTC's. TZ=UTC still pins
// the machine, and the answers no longer depend on it — the zone is in the request.
const { calculateTaskNextOccurrence } = repeating
const LA = 'America/Los_Angeles'
const PARIS = 'Europe/Paris'
const TOKYO = 'Asia/Tokyo'
const LORD_HOWE = 'Australia/Lord_Howe'
const WEEKLY_MWF_UNTIL = (until) => ({ ...WEEKLY_MWF, endCondition: 'until_date', endUntilDate: until })

const completionCases = [
  // D1 — a timed task steps on the person's calendar.
  ['D1 daily at 9am across the spring change, Los Angeles', { repeating: 'daily', currentDueDate: '2026-03-07T17:00:00Z', completion: '2026-03-07T18:00:00Z', repeatFrom: 'DUE_DATE', timeZone: LA }],
  ['D1 daily at 9am across the spring change, UTC (the old answer)', { repeating: 'daily', currentDueDate: '2026-03-07T17:00:00Z', completion: '2026-03-07T18:00:00Z', repeatFrom: 'DUE_DATE', timeZone: 'UTC' }],
  ['D1 weekly across the autumn change, Los Angeles', { repeating: 'weekly', currentDueDate: '2026-10-31T16:00:00Z', completion: '2026-10-31T16:30:00Z', repeatFrom: 'DUE_DATE', timeZone: LA }],
  ['D1 monthly at 2pm across the spring change, Los Angeles', { repeating: 'monthly', currentDueDate: '2026-02-15T22:00:00Z', completion: '2026-02-15T22:00:00Z', repeatFrom: 'DUE_DATE', timeZone: LA }],
  ['D1 monthly clamps on the person\'s calendar, Tokyo', { repeating: 'monthly', currentDueDate: '2026-01-30T16:00:00Z', completion: '2026-01-30T16:00:00Z', repeatFrom: 'DUE_DATE', timeZone: TOKYO }],
  ['D1 yearly on the person\'s calendar, Tokyo', { repeating: 'yearly', currentDueDate: '2026-02-28T16:00:00Z', completion: '2026-02-28T16:00:00Z', repeatFrom: 'DUE_DATE', timeZone: TOKYO }],
  ['D1 evening completion anchors on the person\'s day, Los Angeles', { repeating: 'daily', currentDueDate: '2026-01-05T17:00:00Z', completion: '2026-01-06T02:00:00Z', repeatFrom: 'COMPLETION_DATE', timeZone: LA }],
  ['D1 evening completion, UTC (the old answer)', { repeating: 'daily', currentDueDate: '2026-01-05T17:00:00Z', completion: '2026-01-06T02:00:00Z', repeatFrom: 'COMPLETION_DATE', timeZone: 'UTC' }],
  ['D1 morning completion a day early, Tokyo', { repeating: 'weekly', currentDueDate: '2026-01-07T00:00:00Z', completion: '2026-01-05T23:30:00Z', repeatFrom: 'COMPLETION_DATE', timeZone: TOKYO }],
  ['D1 until is the person\'s date, Paris', { repeating: 'daily', pattern: { endCondition: 'until_date', endUntilDate: '2026-12-14T23:00:00.000Z' }, currentDueDate: '2026-12-14T09:00:00Z', completion: '2026-12-14T09:00:00Z', repeatFrom: 'DUE_DATE', timeZone: PARIS }],
  ['D1 until is the person\'s date, a day past it, Paris', { repeating: 'daily', pattern: { endCondition: 'until_date', endUntilDate: '2026-12-14T23:00:00.000Z' }, currentDueDate: '2026-12-15T09:00:00Z', completion: '2026-12-15T09:00:00Z', repeatFrom: 'DUE_DATE', timeZone: PARIS }],
  ['D1 custom until is the person\'s date, Los Angeles', { repeating: 'custom', pattern: WEEKLY_MWF_UNTIL('2026-01-16T08:00:00.000Z'), currentDueDate: '2026-01-14T17:00:00Z', completion: '2026-01-14T17:00:00Z', repeatFrom: 'DUE_DATE', timeZone: LA }],
  ['D1 every two days across the spring change, Los Angeles', { repeating: 'custom', pattern: { type: 'custom', unit: 'days', interval: 2, endCondition: 'never' }, currentDueDate: '2026-03-07T17:00:00Z', completion: '2026-03-07T17:00:00Z', repeatFrom: 'DUE_DATE', timeZone: LA }],
  ['D1 custom monthly on the 10th across the change, Paris', { repeating: 'custom', pattern: { type: 'custom', unit: 'months', interval: 1, endCondition: 'never', monthRepeatType: 'same_date', monthDay: 10 }, currentDueDate: '2026-03-10T08:00:00Z', completion: '2026-03-10T08:00:00Z', repeatFrom: 'DUE_DATE', timeZone: PARIS }],
  ['D1 custom yearly on a set day, Los Angeles', { repeating: 'custom', pattern: { type: 'custom', unit: 'years', interval: 1, endCondition: 'never', month: 7, day: 4 }, currentDueDate: '2026-01-15T17:00:00Z', completion: '2026-01-15T17:00:00Z', repeatFrom: 'DUE_DATE', timeZone: LA }],
  // All-day tasks step on UTC's calendar wherever the person is.
  ['all-day daily stays at UTC midnight, Los Angeles', { repeating: 'daily', currentDueDate: '2026-03-07T00:00:00Z', completion: '2026-03-07T05:00:00Z', repeatFrom: 'DUE_DATE', timeZone: LA, isAllDay: true }],
  ['all-day monthly stays at UTC midnight, Tokyo', { repeating: 'monthly', currentDueDate: '2026-01-31T00:00:00Z', completion: '2026-01-31T00:00:00Z', repeatFrom: 'DUE_DATE', timeZone: TOKYO, isAllDay: true }],
  ['all-day third Tuesday stays at UTC midnight, Los Angeles', { repeating: 'custom', pattern: THIRD_TUESDAY, currentDueDate: '2026-01-20T00:00:00Z', completion: '2026-01-20T00:00:00Z', repeatFrom: 'DUE_DATE', timeZone: LA, isAllDay: true }],
  ['all-day from completion anchors on the person\'s day, Los Angeles', { repeating: 'weekly', currentDueDate: '2026-01-05T00:00:00Z', completion: '2026-01-06T05:00:00Z', repeatFrom: 'COMPLETION_DATE', timeZone: LA, isAllDay: true }],
  ['all-day from completion with the day sent as UTC midnight', { repeating: 'weekly', currentDueDate: '2026-01-05T00:00:00Z', completion: '2026-01-05T00:00:00Z', repeatFrom: 'COMPLETION_DATE', timeZone: 'UTC', isAllDay: true }],
  ['all-day from completion, Tokyo morning', { repeating: 'daily', currentDueDate: '2026-01-05T00:00:00Z', completion: '2026-01-06T22:30:00Z', repeatFrom: 'COMPLETION_DATE', timeZone: TOKYO, isAllDay: true }],
  // D3 — "the third Tuesday" is a Tuesday where the person lives (midnight on their clock).
  ['D3 the third Tuesday, Los Angeles', { repeating: 'custom', pattern: THIRD_TUESDAY, currentDueDate: '2026-01-20T18:00:00Z', completion: '2026-01-20T18:00:00Z', repeatFrom: 'DUE_DATE', timeZone: LA }],
  ['D3 the third Tuesday, Tokyo', { repeating: 'custom', pattern: THIRD_TUESDAY, currentDueDate: '2026-01-20T01:00:00Z', completion: '2026-01-20T01:00:00Z', repeatFrom: 'DUE_DATE', timeZone: TOKYO }],
  ['D3 the third Tuesday, UTC (the old answer)', { repeating: 'custom', pattern: THIRD_TUESDAY, currentDueDate: '2026-01-20T18:00:00Z', completion: '2026-01-20T18:00:00Z', repeatFrom: 'DUE_DATE', timeZone: 'UTC' }],
  // D4 — a custom pattern answers the same wherever the code runs; the zone is the person's.
  ['D4 Mon/Wed/Fri from Monday 8am, Tokyo', { repeating: 'custom', pattern: WEEKLY_MWF, currentDueDate: '2026-01-04T23:00:00Z', completion: '2026-01-04T23:00:00Z', repeatFrom: 'DUE_DATE', timeZone: TOKYO }],
  ['D4 Mon/Wed/Fri from Friday 6pm, Los Angeles', { repeating: 'custom', pattern: WEEKLY_MWF, currentDueDate: '2026-01-10T02:00:00Z', completion: '2026-01-10T02:00:00Z', repeatFrom: 'DUE_DATE', timeZone: LA }],
  // D2 and D5 are unchanged: every client reproduces them.
  ['D2 every two weeks still advances weekly, Los Angeles', { repeating: 'custom', pattern: { ...WEEKLY_MWF, interval: 2, weekdays: ['monday'] }, currentDueDate: '2026-01-05T17:00:00Z', completion: '2026-01-05T17:00:00Z', repeatFrom: 'DUE_DATE', timeZone: LA }],
  ['D5 custom monthly on the 31st overflows, Los Angeles', { repeating: 'custom', pattern: { type: 'custom', unit: 'months', interval: 1, endCondition: 'never', monthRepeatType: 'same_date', monthDay: 31 }, currentDueDate: '2026-01-31T17:00:00Z', completion: '2026-01-31T17:00:00Z', repeatFrom: 'DUE_DATE', timeZone: LA }],
  // Clock edges.
  ['a time the spring change skips moves an hour later, Los Angeles', { repeating: 'daily', currentDueDate: '2026-03-07T10:30:00Z', completion: '2026-03-07T10:30:00Z', repeatFrom: 'DUE_DATE', timeZone: LA }],
  ['a time the autumn change repeats takes the first, Los Angeles', { repeating: 'daily', currentDueDate: '2026-10-31T08:30:00Z', completion: '2026-10-31T08:30:00Z', repeatFrom: 'DUE_DATE', timeZone: LA }],
  ['a half-hour daylight-saving shift, Lord Howe', { repeating: 'monthly', currentDueDate: '2026-03-10T00:00:00Z', completion: '2026-03-10T00:00:00Z', repeatFrom: 'DUE_DATE', timeZone: LORD_HOWE }],
  // End conditions and counts through the whole rule.
  ['a simple series ends at its occurrence limit', { repeating: 'weekly', pattern: { endCondition: 'after_occurrences', endAfterOccurrences: 3 }, currentDueDate: '2026-01-05T09:00:00Z', completion: '2026-01-05T09:00:00Z', repeatFrom: 'DUE_DATE', occurrenceCount: 2, timeZone: PARIS }],
  ['a simple series one short of its limit', { repeating: 'weekly', pattern: { endCondition: 'after_occurrences', endAfterOccurrences: 3 }, currentDueDate: '2026-01-05T09:00:00Z', completion: '2026-01-05T09:00:00Z', repeatFrom: 'DUE_DATE', occurrenceCount: 1, timeZone: PARIS }],
  ['never outranks a stale limit', { repeating: 'daily', pattern: { endCondition: 'never', endAfterOccurrences: 1 }, currentDueDate: '2026-01-05T09:00:00Z', completion: '2026-01-05T09:00:00Z', repeatFrom: 'DUE_DATE', occurrenceCount: 5 }],
  ['with no due date the completion is the anchor, Los Angeles', { repeating: 'daily', currentDueDate: null, completion: '2026-03-07T20:00:00Z', repeatFrom: 'DUE_DATE', timeZone: LA }],
  ['repeat-from defaults to the completion date', { repeating: 'daily', currentDueDate: '2026-01-05T09:00:00Z', completion: '2026-01-08T12:00:00Z' }],
  // Stored patterns web used to read differently from the core (resolved toward the core, which
  // iOS runs): see the AWTD-1063 PR for each.
  ['a limit of 0 occurrences ends the series', { repeating: 'daily', pattern: { endCondition: 'after_occurrences', endAfterOccurrences: 0 }, currentDueDate: '2026-01-05T09:00:00Z', completion: '2026-01-05T09:00:00Z', repeatFrom: 'DUE_DATE' }],
  ['a yearly month and day from a 31st', { repeating: 'custom', pattern: { type: 'custom', unit: 'years', interval: 1, endCondition: 'never', month: 2, day: 10 }, currentDueDate: '2026-01-31T09:00:00Z', completion: '2026-01-31T09:00:00Z', repeatFrom: 'DUE_DATE' }],
  ['a same-date monthly pattern with no stored day', { repeating: 'custom', pattern: { type: 'custom', unit: 'months', interval: 1, endCondition: 'never', monthRepeatType: 'same_date' }, currentDueDate: '2026-01-15T09:00:00Z', completion: '2026-01-15T09:00:00Z', repeatFrom: 'DUE_DATE' }],
  ['a custom pattern with no interval ends the series', { repeating: 'custom', pattern: { type: 'custom', unit: 'days', endCondition: 'never' }, currentDueDate: '2026-01-05T09:00:00Z', completion: '2026-01-05T09:00:00Z', repeatFrom: 'DUE_DATE' }],
  // A stored interval below 1 is READ as 1 (AWTD-1080), so the series steps instead of re-opening
  // on the same date forever. The write side stores it as 1 already (AWTD-1075); this is the
  // reader, for a row written before that landed or by an offline client that skipped the API.
  ['an interval of 0 days steps one day (AWTD-1080)', { repeating: 'custom', pattern: { type: 'custom', unit: 'days', interval: 0, endCondition: 'never' }, currentDueDate: '2026-01-05T09:00:00Z', completion: '2026-01-05T09:00:00Z', repeatFrom: 'DUE_DATE' }],
  // A missing `monthRepeatType` is READ as `same_date` (AWTD-1077), counted from the repeat
  // anchor. It used to END the series on every client, which is what AWTD-1074 backfilled the ten
  // production patterns for; this is the reader half, changed on every client at once.
  ['a monthly pattern with no monthRepeatType repeats on the same date (AWTD-1077)', { repeating: 'custom', pattern: { type: 'custom', unit: 'months', interval: 6, endCondition: 'never' }, currentDueDate: '2026-01-15T00:00:00Z', completion: '2026-01-15T00:00:00Z', repeatFrom: 'DUE_DATE', isAllDay: true }],
  ['an unknown unit ends the series', { repeating: 'custom', pattern: { type: 'custom', unit: 'fortnights', interval: 1, endCondition: 'never' }, currentDueDate: '2026-01-05T09:00:00Z', completion: '2026-01-05T09:00:00Z', repeatFrom: 'DUE_DATE' }],
]

const completions = completionCases.map(([name, request]) => ({
  name,
  request,
  answer: calculateTaskNextOccurrence(request),
}))

// Several completions in a row, each on its due date, in a zone with daylight saving — the
// multi-step shape that catches what one step misses, now on the person's calendar.
const zonedProgressionCases = [
  ['Mon/Wed/Fri at 9am through the autumn change, Los Angeles', 'custom', WEEKLY_MWF, '2026-10-26T16:00:00Z', LA, false, 6],
  ['the third Tuesday through the spring change, Los Angeles', 'custom', THIRD_TUESDAY, '2026-01-20T18:00:00Z', LA, false, 4],
  ['monthly at 2pm through a year, Paris', 'monthly', null, '2026-01-15T13:00:00Z', PARIS, false, 12],
  ['daily at 1:30am through the autumn change, Los Angeles', 'daily', null, '2026-10-30T08:30:00Z', LA, false, 4],
]

const zonedProgressions = zonedProgressionCases.map(([name, type, pattern, start, timeZone, isAllDay, steps]) => {
  const dates = []
  let current = start
  let occurrenceCount = 0
  for (let i = 0; i < steps; i++) {
    const answer = calculateTaskNextOccurrence({
      repeating: type, pattern, currentDueDate: current, completion: current,
      repeatFrom: 'DUE_DATE', occurrenceCount, timeZone, isAllDay,
    })
    if (!answer.nextDueDate) break
    dates.push(answer.nextDueDate)
    current = answer.nextDueDate
    occurrenceCount = answer.newOccurrenceCount
  }
  return { name, repeating: type, pattern, start, timeZone, isAllDay, steps, dates }
})

process.stdout.write(
  JSON.stringify({ simple, simpleEndConditions, custom, customProgressions, completions, zonedProgressions }, null, 2),
)
