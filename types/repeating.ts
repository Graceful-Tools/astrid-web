// Custom repeating task patterns, and the rollover arithmetic for every repeating task.
//
// THE ARITHMETIC IS ASTRID-CORE'S (AWTD-1063). On the Node server, lib/repeating-rollover.ts asks
// astrid-core's `nextOccurrence` rule. That is the code the iOS and Mac apps run, and its answer
// is returned. This file is the same rule in TypeScript, for two jobs:
//   - the server's fail-safe answer when the core cannot give one, and
//   - the canonical source the shared fixture is generated from
//     (scripts/contract-fixtures/drivers/repeating.mjs).
// tests/lib/core-rules-repeating-parity.test.ts holds the two to the same answers over every case.
// Change the rule here, regenerate the fixture, port it in astrid-core, then rebuild
// packages/astrid-rules. The parity test fails until all three agree.
//
// CALENDAR ARITHMETIC HAPPENS IN A ZONE (astrid-core docs/CONTRACTS.md D1, D3 and D4, resolved
// toward iOS on 2026-10-03). Every step (a day, a month, "the third Tuesday", "until the 15th") is
// taken on the wall clock of a named IANA zone and turned back into an instant:
//   - an ALL-DAY task steps in UTC, because its date is stored as UTC midnight and names a day;
//   - a TIMED task steps in the person's zone, so "monthly at 2pm" stays 2pm across a
//     daylight-saving change and "the third Tuesday" is a Tuesday where they live.
// With no zone the calendar is UTC, which is every answer this file gave before. Nothing here reads
// the machine's own zone: the answer must not depend on where the code runs (D4).
//
// This module imports nothing. The fixture driver runs it under plain Node.

export type RepeatingUnit = 'days' | 'weeks' | 'months' | 'years'

export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'

export type MonthRepeatType = 'same_date' | 'same_weekday'

export type RepeatEndCondition = 'never' | 'after_occurrences' | 'until_date'

export interface BaseRepeatingPattern {
  type: 'custom'
  unit: RepeatingUnit
  interval: number // Every X days/weeks/months/years
  endCondition: RepeatEndCondition
  endAfterOccurrences?: number
  endUntilDate?: Date
}

export interface DailyRepeatingPattern extends BaseRepeatingPattern {
  unit: 'days'
}

export interface WeeklyRepeatingPattern extends BaseRepeatingPattern {
  unit: 'weeks'
  weekdays: Weekday[] // Which days of the week (e.g., ['monday', 'wednesday', 'friday'])
}

export interface MonthlyRepeatingPattern extends BaseRepeatingPattern {
  unit: 'months'
  monthRepeatType: MonthRepeatType
  // For same_date: use the day of month (1-31)
  // For same_weekday: use {weekday: 'monday', weekOfMonth: 3} for "3rd Monday"
  monthDay?: number // 1-31 for same_date
  monthWeekday?: {
    weekday: Weekday
    weekOfMonth: number // 1-5 (1st, 2nd, 3rd, 4th, 5th week of month)
  }
}

export interface YearlyRepeatingPattern extends BaseRepeatingPattern {
  unit: 'years'
  month: number // 1-12
  day: number // 1-31
}

export type CustomRepeatingPattern =
  | DailyRepeatingPattern
  | WeeklyRepeatingPattern
  | MonthlyRepeatingPattern
  | YearlyRepeatingPattern

/** A simple pattern's optional end condition, stored in `repeatingData` beside it. */
export interface SimplePatternEndCondition {
  endCondition: RepeatEndCondition
  endAfterOccurrences?: number
  endUntilDate?: Date
}

export type RepeatFrom = 'DUE_DATE' | 'COMPLETION_DATE'

export type SimpleRepeating = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface NextOccurrenceResult {
  nextDueDate: Date | null
  shouldTerminate: boolean
  newOccurrenceCount: number
}

// ── Wall clocks ─────────────────────────────────────────────────────────────────────────────────
//
// A "reading" is a wall-clock time in some zone, held as the milliseconds it would be if that zone
// were UTC. That way the UTC getters and Date.UTC do calendar arithmetic on it with no zone at all.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const WEEKDAYS: readonly Weekday[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const END_CONDITIONS: ReadonlySet<unknown> = new Set(['never', 'after_occurrences', 'until_date'])
const MONTH_REPEAT_TYPES: ReadonlySet<unknown> = new Set(['same_date', 'same_weekday'])

const formatters = new Map<string, Intl.DateTimeFormat>()

function isUtc(zone: string): boolean {
  return zone === 'UTC' || zone === 'Etc/UTC'
}

/** Is `zone` an IANA name this runtime knows? An unknown zone is refused, never read as UTC. */
export function isKnownTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || zone.length === 0) return false
  if (isUtc(zone)) return true
  try {
    formatterFor(zone)
    return true
  } catch {
    return false
  }
}

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      era: 'short',
    })
    formatters.set(zone, formatter)
  }
  return formatter
}

/** The wall-clock reading of instant `ms` in `zone`. */
function local(ms: number, zone: string): number {
  if (isUtc(zone)) return ms
  const subSecond = ((ms % 1000) + 1000) % 1000
  const parts: Record<string, string> = {}
  for (const part of formatterFor(zone).formatToParts(new Date(ms - subSecond))) parts[part.type] = part.value
  const year = parts.era === 'BC' || parts.era === 'B' ? 1 - Number(parts.year) : Number(parts.year)
  const reading = new Date(0)
  reading.setUTCFullYear(year, Number(parts.month) - 1, Number(parts.day))
  reading.setUTCHours(Number(parts.hour), Number(parts.minute), Number(parts.second), subSecond)
  return reading.getTime()
}

/** Every instant that reads `reading` in `zone`, earliest first: none in a gap, two in an overlap. */
function instantsReading(reading: number, zone: string): number[] {
  // An offset in force within a day either side of the reading. A real zone changes offset at most
  // once in that window, so these cover every instant that can read it.
  const offsets = new Set([reading - DAY, reading, reading + DAY].map((at) => local(at, zone) - at))
  return [...offsets]
    .map((offset) => reading - offset)
    .filter((at) => local(at, zone) === reading)
    .sort((a, b) => a - b)
}

/**
 * A wall-clock reading in `zone` as an instant, as astrid-core's `instant` takes it. A reading the
 * clock skips (the hour a spring-forward removes) lands an hour later, which is where the person's
 * clock is by then. A reading it shows twice (the hour a fall-back repeats) takes the first.
 */
function instant(reading: number, zone: string): number {
  if (isUtc(zone)) return reading
  const [first] = instantsReading(reading, zone)
  if (first !== undefined) return first
  const [later] = instantsReading(reading + HOUR, zone)
  return later !== undefined ? later : reading
}

const dateOf = (reading: number) => Math.floor(reading / DAY) * DAY
const timeOf = (reading: number) => reading - dateOf(reading)
const daysInMonth = (year: number, month0: number) => new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()

/** A calendar date, letting a day past the month's end roll on into the next, as JS setters do. */
function overflowingDate(year: number, month0: number, day: number, time: number): number {
  const date = new Date(0)
  date.setUTCFullYear(year, month0, 1)
  return date.getTime() + (day - 1) * DAY + time
}

/** Add whole calendar days on the zone's clock: in UTC that is elapsed time; elsewhere 9am stays 9am. */
function addingDays(ms: number, days: number, zone: string): number {
  return instant(local(ms, zone) + days * DAY, zone)
}

/** Add months, clamping the day: 31 January plus a month is the last day of February. */
function addingMonths(ms: number, months: number, zone: string): number {
  const reading = new Date(local(ms, zone))
  const month0 = reading.getUTCMonth() + months
  const year = reading.getUTCFullYear() + Math.floor(month0 / 12)
  const targetMonth0 = ((month0 % 12) + 12) % 12
  const day = Math.min(reading.getUTCDate(), daysInMonth(year, targetMonth0))
  return instant(overflowingDate(year, targetMonth0, day, timeOf(reading.getTime())), zone)
}

/**
 * Add months keeping the day of the month, letting a day the target month lacks spill forward:
 * 31 January plus a month is 2 March (D5, reproduced on every client until it is fixed on all).
 */
function addingMonthsOverflowing(ms: number, months: number, zone: string): number {
  const reading = new Date(local(ms, zone))
  const month0 = reading.getUTCMonth() + months
  const year = reading.getUTCFullYear() + Math.floor(month0 / 12)
  return instant(overflowingDate(year, ((month0 % 12) + 12) % 12, reading.getUTCDate(), timeOf(reading.getTime())), zone)
}

/** Add years keeping the day: 29 February 2024 plus a year is 1 March 2025 (D5). */
function addingYears(ms: number, years: number, zone: string): number {
  const reading = new Date(local(ms, zone))
  return instant(
    overflowingDate(reading.getUTCFullYear() + years, reading.getUTCMonth(), reading.getUTCDate(), timeOf(reading.getTime())),
    zone,
  )
}

/**
 * The instant the next occurrence is measured from: the chosen base date, wearing the time of day
 * the task was due, both read on the zone's clock. Completing a 9am task at 11pm keeps it at 9am.
 */
function anchorDate(currentDueDate: number | null, completionDate: number, repeatFrom: RepeatFrom, zone: string): number {
  if (currentDueDate === null) return completionDate
  const base = repeatFrom === 'DUE_DATE' ? currentDueDate : completionDate
  return instant(dateOf(local(base, zone)) + timeOf(local(currentDueDate, zone)), zone)
}

/** Date-only comparison on the zone's calendar: "repeat until 15 December" still runs on the 15th. */
function isAfterDate(candidate: number, end: number, zone: string): boolean {
  return dateOf(local(candidate, zone)) > dateOf(local(end, zone))
}

// ── Reading a stored pattern ────────────────────────────────────────────────────────────────────
//
// The column is free-form JSON that older clients wrote subsets of. A value this file does not
// recognise reads as absent, and a pattern missing what its unit needs ends the series rather than
// guessing (astrid-core `pattern_from_wire`).

interface ReadPattern {
  unit: string | null
  interval: number | null
  endCondition: RepeatEndCondition | null
  endAfterOccurrences: number | null
  endUntilDate: number | null
  weekdays: Weekday[] | null
  monthRepeatType: MonthRepeatType | null
  monthWeekday: { weekday: Weekday; weekOfMonth: number } | null
  month: number | null
  day: number | null
}

const integer = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null
const nonNegative = (value: unknown): number | null => {
  const n = integer(value)
  return n !== null && n >= 0 ? n : null
}
const weekdayOf = (value: unknown): Weekday | null =>
  typeof value === 'string' && (WEEKDAYS as readonly string[]).includes(value) ? (value as Weekday) : null

function instantOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  // A Date from another realm (or a test's stand-in Date class) is still a Date.
  const isDate = Object.prototype.toString.call(value) === '[object Date]'
  if (!isDate && typeof value !== 'string' && typeof value !== 'number') return null
  const ms = isDate ? (value as Date).getTime() : new Date(value as string | number).getTime()
  return Number.isNaN(ms) ? null : ms
}

function readPattern(stored: unknown): ReadPattern {
  const p = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
  const monthWeekday = p.monthWeekday && typeof p.monthWeekday === 'object' ? (p.monthWeekday as Record<string, unknown>) : null
  const mwWeekday = monthWeekday ? weekdayOf(monthWeekday.weekday) : null
  const mwWeek = monthWeekday ? nonNegative(monthWeekday.weekOfMonth) : null
  return {
    unit: typeof p.unit === 'string' ? p.unit : null,
    interval: integer(p.interval),
    endCondition: END_CONDITIONS.has(p.endCondition) ? (p.endCondition as RepeatEndCondition) : null,
    endAfterOccurrences: integer(p.endAfterOccurrences),
    endUntilDate: instantOf(p.endUntilDate),
    weekdays: Array.isArray(p.weekdays) ? p.weekdays.map(weekdayOf).filter((d): d is Weekday => d !== null) : null,
    monthRepeatType: MONTH_REPEAT_TYPES.has(p.monthRepeatType) ? (p.monthRepeatType as MonthRepeatType) : null,
    monthWeekday: mwWeekday !== null && mwWeek !== null ? { weekday: mwWeekday, weekOfMonth: mwWeek } : null,
    month: nonNegative(p.month),
    day: nonNegative(p.day),
  }
}

// ── The calculators ─────────────────────────────────────────────────────────────────────────────

/** The next selected weekday strictly after `ms`, by the zone's calendar. `interval` plays no part (D2). */
function nextWeekdayOccurrence(ms: number, weekdays: Weekday[], zone: string): number | null {
  if (weekdays.length === 0) return null
  for (let offset = 1; offset <= 7; offset++) {
    const candidate = addingDays(ms, offset, zone)
    if (weekdays.includes(WEEKDAYS[new Date(local(candidate, zone)).getUTCDay()])) return candidate
  }
  return null
}

function nextMonthOccurrence(ms: number, pattern: ReadPattern, interval: number, zone: string): number | null {
  if (interval < 0) return null
  if (pattern.monthRepeatType === 'same_date') return addingMonthsOverflowing(ms, interval, zone)
  if (pattern.monthRepeatType !== 'same_weekday' || !pattern.monthWeekday) return null
  const { weekday, weekOfMonth } = pattern.monthWeekday
  // The intermediate step only decides WHICH month to search, and it overflows too (D5).
  const target = new Date(local(addingMonthsOverflowing(ms, interval, zone), zone))
  const first = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), 1)
  const firstWeekday = new Date(first).getUTCDay()
  const offset = ((WEEKDAYS.indexOf(weekday) - firstWeekday + 7) % 7) + Math.max(weekOfMonth - 1, 0) * 7
  // The time of day is lost: the date is built from the first of the month, which is midnight on
  // the zone's clock, so the day is the one the person sees (D3).
  return instant(first + offset * DAY, zone)
}

function nextYearOccurrence(ms: number, pattern: ReadPattern, interval: number, zone: string): number {
  const reading = new Date(local(ms, zone))
  const month = pattern.month ?? reading.getUTCMonth() + 1
  const day = pattern.day ?? reading.getUTCDate()
  // A month outside 1-12 names no date; the series stays where it is rather than guessing.
  if (month < 1 || month > 12) return ms
  return instant(overflowingDate(reading.getUTCFullYear() + interval, month - 1, day, timeOf(reading.getTime())), zone)
}

function customNext(
  pattern: ReadPattern,
  currentDueDate: number | null,
  completionDate: number,
  repeatFrom: RepeatFrom,
  currentOccurrenceCount: number,
  zone: string,
): { next: number | null; newOccurrenceCount: number } {
  const newOccurrenceCount = currentOccurrenceCount + 1
  const ended = { next: null, newOccurrenceCount }

  if (
    pattern.endCondition === 'after_occurrences' &&
    pattern.endAfterOccurrences !== null &&
    newOccurrenceCount >= pattern.endAfterOccurrences
  ) {
    return ended
  }

  const anchor = anchorDate(currentDueDate, completionDate, repeatFrom, zone)
  if (pattern.unit === null || pattern.interval === null) return ended

  let next: number | null
  switch (pattern.unit) {
    case 'days':
      next = addingDays(anchor, pattern.interval, zone)
      break
    case 'weeks':
      next = pattern.weekdays ? nextWeekdayOccurrence(anchor, pattern.weekdays, zone) : null
      break
    case 'months':
      next = nextMonthOccurrence(anchor, pattern, pattern.interval, zone)
      break
    case 'years':
      next = nextYearOccurrence(anchor, pattern, pattern.interval, zone)
      break
    default:
      next = null
  }
  if (next === null) return ended

  if (pattern.endCondition === 'until_date' && pattern.endUntilDate !== null && isAfterDate(next, pattern.endUntilDate, zone)) {
    return ended
  }
  return { next, newOccurrenceCount }
}

function simpleNext(repeating: SimpleRepeating, currentDueDate: number | null, completionDate: number, repeatFrom: RepeatFrom, zone: string): number {
  const anchor = anchorDate(currentDueDate, completionDate, repeatFrom, zone)
  switch (repeating) {
    case 'daily':
      return addingDays(anchor, 1, zone)
    case 'weekly':
      return addingDays(anchor, 7, zone)
    case 'monthly':
      return addingMonths(anchor, 1, zone)
    case 'yearly':
      return addingYears(anchor, 1, zone)
  }
}

function simpleEnds(next: number, newOccurrenceCount: number, end: ReadPattern | null, zone: string): boolean {
  if (!end || end.endCondition === null) return false
  switch (end.endCondition) {
    // "Never" outranks a limit left behind by an earlier edit.
    case 'never':
      return false
    case 'after_occurrences':
      return end.endAfterOccurrences !== null && newOccurrenceCount >= end.endAfterOccurrences
    case 'until_date':
      return end.endUntilDate !== null && isAfterDate(next, end.endUntilDate, zone)
  }
}

const SIMPLE: ReadonlySet<unknown> = new Set(['daily', 'weekly', 'monthly', 'yearly'])

/** Is `zone` usable here, read as UTC when absent. Throws for a zone this runtime does not know. */
function zoneOrUtc(zone: string | null | undefined): string {
  if (zone === null || zone === undefined) return 'UTC'
  if (!isKnownTimeZone(zone)) throw new RangeError(`${zone} is not a time zone this runtime knows`)
  return zone
}

// ── The whole rule, as the server asks it ───────────────────────────────────────────────────────

/**
 * astrid-core's `nextOccurrence` request, in its wire names: a task's repeat fields plus the
 * instant it was completed and the person's zone.
 */
export interface TaskNextOccurrenceInput {
  /** `daily`, `weekly`, `monthly`, `yearly` or `custom`. */
  repeating: string
  /** `repeatingData`: the custom pattern, or a simple pattern's end condition. */
  pattern?: unknown
  currentDueDate?: string | Date | null
  /**
   * The instant it was completed. For an all-day task repeating from completion, the day it names
   * is read in `timeZone`; a caller that knows the person's calendar day instead sends that day's
   * UTC midnight with `timeZone` UTC.
   */
  completion: string | Date
  repeatFrom?: RepeatFrom | null
  occurrenceCount?: number | null
  /** IANA name. UTC when absent; an unknown name throws rather than reading as UTC. */
  timeZone?: string | null
  /** An all-day series steps in UTC, whatever the zone: its dates are UTC midnights. */
  isAllDay?: boolean
}

/** astrid-core's answer, in its wire names. `nextDueDate` is null exactly when the series ends. */
export interface TaskNextOccurrence {
  nextDueDate: string | null
  shouldTerminate: boolean
  newOccurrenceCount: number
}

/**
 * Where a repeating task goes next, read off its own fields: astrid-core's `nextOccurrence`,
 * answer for answer. A pattern the series cannot continue from ends it.
 */
export function calculateTaskNextOccurrence(input: TaskNextOccurrenceInput): TaskNextOccurrence {
  const zone = zoneOrUtc(input.timeZone)
  const calendar = input.isAllDay ? 'UTC' : zone
  const due = instantOf(input.currentDueDate)
  const completedAt = instantOf(input.completion)
  if (completedAt === null) throw new RangeError('completion is not a date')
  const repeatFrom: RepeatFrom = input.repeatFrom === 'DUE_DATE' ? 'DUE_DATE' : 'COMPLETION_DATE'
  // An all-day task repeating from its completion anchors on the calendar day the person completed
  // it on, stored the way all-day dates are (UTC midnight). Ticking one off at 9pm in California
  // is 5am UTC the next day, and anchoring on that instant would move the series a day late.
  const completion = input.isAllDay && repeatFrom === 'COMPLETION_DATE' ? dateOf(local(completedAt, zone)) : completedAt
  const count = integer(input.occurrenceCount) ?? 0
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString())

  if (input.repeating === 'custom' && input.pattern) {
    const { next, newOccurrenceCount } = customNext(readPattern(input.pattern), due, completion, repeatFrom, count, calendar)
    return { nextDueDate: iso(next), shouldTerminate: next === null, newOccurrenceCount }
  }

  const newOccurrenceCount = count + 1
  if (!SIMPLE.has(input.repeating)) {
    // Not a simple pattern (custom with nothing stored, or never): the anchor, unchanged, as the core answers.
    // The server never asks this: lib/repeating-task-handler.ts rolls only patterns it can step.
    return { nextDueDate: iso(anchorDate(due, completion, repeatFrom, calendar)), shouldTerminate: false, newOccurrenceCount }
  }
  const next = simpleNext(input.repeating as SimpleRepeating, due, completion, repeatFrom, calendar)
  const end = input.pattern ? readPattern(input.pattern) : null
  const ends = simpleEnds(next, newOccurrenceCount, end, calendar)
  return { nextDueDate: ends ? null : iso(next), shouldTerminate: ends, newOccurrenceCount }
}

// ── The calculator's pieces, by their old names ─────────────────────────────────────────────────
//
// Kept for the fixture driver and the unit tests, which call them directly. Each takes the zone
// last and reads UTC when it is left out.

/** Next occurrence for a custom pattern after a completion. */
export function calculateNextOccurrence(
  pattern: CustomRepeatingPattern,
  currentDueDate: Date | null,
  completionDate: Date,
  repeatFrom: RepeatFrom,
  currentOccurrenceCount: number,
  timeZone: string = 'UTC',
): NextOccurrenceResult {
  const zone = zoneOrUtc(timeZone)
  const { next, newOccurrenceCount } = customNext(
    readPattern(pattern),
    instantOf(currentDueDate),
    completionDate.getTime(),
    repeatFrom,
    currentOccurrenceCount,
    zone,
  )
  return { nextDueDate: next === null ? null : new Date(next), shouldTerminate: next === null, newOccurrenceCount }
}

/** Next occurrence for a simple pattern (daily, weekly, monthly, yearly). End conditions are separate. */
export function calculateSimpleRepeatingNextOccurrence(
  repeatingType: SimpleRepeating,
  currentDueDate: Date | null,
  completionDate: Date,
  repeatFrom: RepeatFrom,
  timeZone: string = 'UTC',
): Date {
  return new Date(simpleNext(repeatingType, instantOf(currentDueDate), completionDate.getTime(), repeatFrom, zoneOrUtc(timeZone)))
}

/** Whether a simple pattern's end condition is reached by `nextDueDate`. */
export function checkSimplePatternEndCondition(
  nextDueDate: Date,
  newOccurrenceCount: number,
  endData: SimplePatternEndCondition | null,
  timeZone: string = 'UTC',
): { shouldTerminate: boolean; newOccurrenceCount: number } {
  const end = endData ? readPattern(endData) : null
  return {
    shouldTerminate: simpleEnds(nextDueDate.getTime(), newOccurrenceCount, end, zoneOrUtc(timeZone)),
    newOccurrenceCount,
  }
}

/** Is this a pattern the editor may save? Interval of at least 1, and what its unit needs. */
export function isValidRepeatingPattern(pattern: CustomRepeatingPattern): boolean {
  if (pattern.interval < 1) return false

  switch (pattern.unit) {
    case 'days':
      return true

    case 'weeks':
      return !!(pattern as WeeklyRepeatingPattern).weekdays && (pattern as WeeklyRepeatingPattern).weekdays.length > 0

    case 'months': {
      const monthPattern = pattern as MonthlyRepeatingPattern
      if (monthPattern.monthRepeatType === 'same_date') {
        return !!(monthPattern.monthDay && monthPattern.monthDay >= 1 && monthPattern.monthDay <= 31)
      }
      return !!(monthPattern.monthWeekday && monthPattern.monthWeekday.weekOfMonth >= 1 && monthPattern.monthWeekday.weekOfMonth <= 5)
    }

    case 'years': {
      const yearPattern = pattern as YearlyRepeatingPattern
      return yearPattern.month >= 1 && yearPattern.month <= 12 && yearPattern.day >= 1 && yearPattern.day <= 31
    }

    default:
      return false
  }
}
