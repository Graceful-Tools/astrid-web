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

process.stdout.write(
  JSON.stringify({ simple, simpleEndConditions, custom, customProgressions }, null, 2),
)
