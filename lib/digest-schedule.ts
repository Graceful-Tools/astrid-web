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

/** Minutes past midnight for an "HH:MM" setting, or null when it does not parse. */
function minuteOfDay(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!match) return null
  const [hours, minutes] = [Number(match[1]), Number(match[2])]
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null
}

/**
 * Whether `now` falls in the minute the person's clock shows `dailyDigestTime`.
 *
 * Exactly one minute, because the cron runs every minute: any wider window would send once per
 * tick inside it.
 */
export function isDigestMinute(dailyDigestTime: string, zone: string, now: Date): boolean {
  const target = minuteOfDay(dailyDigestTime)
  if (target === null) return false
  const clock = wallClockIn(now, digestZone(zone))
  return clock.getUTCHours() * 60 + clock.getUTCMinutes() === target
}

/** 0 = Sunday … 6 = Saturday, on the person's clock. */
export function weekdayIn(now: Date, zone: string): number {
  return wallClockIn(now, digestZone(zone)).getUTCDay()
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
