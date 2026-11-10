/**
 * Dates in digest emails, on the recipient's calendar (AWTD-1545).
 *
 * The digest is sent at the user's own time and its lists are built from the user's days
 * (lib/digest-schedule.ts, AWTD-1453), but lib/email-reminder-service.ts formatted every date
 * with a bare toLocaleDateString — the server's zone, UTC on Vercel. An Auckland digest at
 * 07:00 Monday was headed Sunday, and a Los Angeles user's 9am task read "Today at 5:00 PM".
 *
 * Every function takes the user's `dailyDigestTimezone`; an unknown or missing zone reads as UTC
 * (digestZone), which is what the emails did before, so nothing can throw at send time.
 *
 * All-day dates are stored at UTC midnight of their calendar day (lib/date-comparison.ts), so they
 * are read in UTC and shown without a time: converting one to Los Angeles would put it on the
 * previous evening.
 */
import { digestZone } from '@/lib/digest-schedule'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** The calendar day `date` falls on in `zone`, as UTC midnight of that day (for day arithmetic). */
function dayIn(date: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date)
  const part = (type: string) => Number(parts.find(p => p.type === type)?.value)
  return Date.UTC(part('year'), part('month') - 1, part('day'))
}

/** "Monday, November 9, 2026" — the digest header. */
export function digestLongDate(now: Date, zone: string | null | undefined): string {
  return now.toLocaleDateString('en-US', {
    timeZone: digestZone(zone),
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/** "November 9" — the daily digest subject. */
export function digestShortDate(now: Date, zone: string | null | undefined): string {
  return now.toLocaleDateString('en-US', { timeZone: digestZone(zone), month: 'long', day: 'numeric' })
}

/** "Today at 9:00 AM", "Tomorrow", "Fri, Nov 6 at 9:00 AM (2 days overdue)". */
export function digestDueText(
  due: Date,
  options: { now: Date; zone: string | null | undefined; isOverdue?: boolean; isAllDay?: boolean },
): string {
  const zone = digestZone(options.zone)
  // An all-day date is its UTC calendar day; a timed one is wherever its instant falls for the user.
  const dateZone = options.isAllDay ? 'UTC' : zone
  const diffDays = Math.round((dayIn(due, dateZone) - dayIn(options.now, zone)) / MS_PER_DAY)

  const dateString = due.toLocaleDateString('en-US', { timeZone: dateZone, weekday: 'short', month: 'short', day: 'numeric' })
  const at = options.isAllDay
    ? ''
    : ` at ${due.toLocaleTimeString('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true })}`

  if (options.isOverdue) return `${dateString}${at} (${Math.abs(diffDays)} days overdue)`
  if (diffDays === 0) return `Today${at}`
  if (diffDays === 1) return `Tomorrow${at}`
  if (diffDays === -1) return `Yesterday${at}`
  return `${dateString}${at}`
}

/** "Nov 8 - Nov 14" — the recipient's Sunday to Saturday containing `now`. */
export function digestWeekRange(now: Date, zone: string | null | undefined): string {
  const today = dayIn(now, digestZone(zone))
  const sunday = today - new Date(today).getUTCDay() * MS_PER_DAY
  const label = (ms: number) => new Date(ms).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
  return `${label(sunday)} - ${label(sunday + 6 * MS_PER_DAY)}`
}
