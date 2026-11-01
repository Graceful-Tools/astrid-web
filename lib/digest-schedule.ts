/**
 * When a person's digest is due, and which calendar days it reports on — both read on the
 * person's own clock (`dailyDigestTimezone`), never the server's (AWTD-1453).
 *
 * Pure: no database, no clock of its own. The cron passes `now`.
 */
import type { Prisma } from '@prisma/client'
import { instantOfWallClock, isKnownTimeZone, wallClockIn } from '@/types/repeating'

/** The zone a digest is read in. An unknown zone name reads as UTC rather than failing the digest. */
export function digestZone(zone: string | null | undefined): string {
  return isKnownTimeZone(zone) ? zone : 'UTC'
}

const DEFAULT_DIGEST_MINUTE = 9 * 60 // the schema default, "09:00"

/** Minutes past midnight for an "HH:MM" setting; one that does not parse reads as the default. */
function minuteOfDay(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!match) return DEFAULT_DIGEST_MINUTE
  const [hours, minutes] = [Number(match[1]), Number(match[2])]
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : DEFAULT_DIGEST_MINUTE
}

/**
 * The first instant after `after` at which the person's clock shows `dailyDigestTime` — on a
 * Monday when `weekday` is 1, any day when it is omitted (AWTD-1454). A time the clock skips at a
 * DST change lands an hour later; one it shows twice is taken once.
 */
export function nextDigestAt(dailyDigestTime: string, zone: string, after: Date, weekday?: number): Date {
  const safeZone = digestZone(zone)
  const minute = minuteOfDay(dailyDigestTime)
  const clock = wallClockIn(after, safeZone)
  const [year, month0, day] = [clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate()]
  for (let n = 0; ; n++) {
    const reading = new Date(Date.UTC(year, month0, day + n, 0, minute))
    if (weekday !== undefined && reading.getUTCDay() !== weekday) continue
    const at = instantOfWallClock(reading, safeZone)
    if (at.getTime() > after.getTime()) return at
  }
}

/** Monday, as `nextDigestAt`'s `weekday`. The weekly digest goes out on the person's Monday. */
export const WEEKLY_DIGEST_WEEKDAY = 1

const DIGEST_SETTINGS = ['enableDailyDigest', 'dailyDigestTime', 'dailyDigestTimezone'] as const

/**
 * For a ReminderSettings write: when it touches a digest setting, also clear both schedules, so
 * the cron recomputes them from the new settings on its next run (AWTD-1454). Spread into the
 * write's `data` (and an upsert's `create`, harmlessly).
 */
export function digestScheduleReset(
  data: Partial<Record<(typeof DIGEST_SETTINGS)[number], unknown>>
): { nextDailyDigestAt?: null; nextWeeklyDigestAt?: null } {
  return DIGEST_SETTINGS.some((key) => data[key] !== undefined)
    ? { nextDailyDigestAt: null, nextWeeklyDigestAt: null }
    : {}
}

/**
 * One calendar day on the person's clock, `offsetDays` from today, as the two ranges a task can be
 * due in it: a timed task by the instants of that day's local midnights, an all-day task by its
 * stored UTC midnight of the date (lib/date-comparison.ts).
 */
export interface DigestDay {
  from: Date
  to: Date
  allDayFrom: Date
  allDayTo: Date
}

export function digestDay(now: Date, zone: string, offsetDays: number): DigestDay {
  const safeZone = digestZone(zone)
  const clock = wallClockIn(now, safeZone)
  const [year, month0, day] = [clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate()]
  const allDay = (n: number) => new Date(Date.UTC(year, month0, day + n))
  const midnight = (n: number) => instantOfWallClock(allDay(n), safeZone)
  return {
    from: midnight(offsetDays),
    to: midnight(offsetDays + 1),
    allDayFrom: allDay(offsetDays),
    allDayTo: allDay(offsetDays + 1),
  }
}

/** Tasks due from the start of `first` up to (not including) the start of `end`. */
export function dueBetween(first: DigestDay, end: DigestDay, timedFrom: Date = first.from): Prisma.TaskWhereInput {
  return {
    OR: [
      { isAllDay: false, dueDateTime: { gte: timedFrom, lt: end.from } },
      { isAllDay: true, dueDateTime: { gte: first.allDayFrom, lt: end.allDayFrom } },
    ],
  }
}

/** Tasks due on `day`. */
export function dueOn(day: DigestDay): Prisma.TaskWhereInput {
  return {
    OR: [
      { isAllDay: false, dueDateTime: { gte: day.from, lt: day.to } },
      { isAllDay: true, dueDateTime: { gte: day.allDayFrom, lt: day.allDayTo } },
    ],
  }
}

/** Tasks due before `day` began. */
export function dueBefore(day: DigestDay): Prisma.TaskWhereInput {
  return {
    OR: [
      { isAllDay: false, dueDateTime: { lt: day.from } },
      { isAllDay: true, dueDateTime: { lt: day.allDayFrom } },
    ],
  }
}
