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
 *
 * Each also takes the reader's locale (AWTD-1592): month and weekday names, the order of day and
 * month, the clock (17:00 or 5:00 PM) and the words around them ("Today at", "2 days overdue").
 * Omitted, it is English exactly as before.
 */
import { digestZone } from '@/lib/digest-schedule'
import type { Locale } from '@/lib/i18n/config'
import { clockOptions, englishNotificationTranslator, intlTag, type NotificationTranslator } from '@/lib/i18n/user-locale'

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
export function digestLongDate(now: Date, zone: string | null | undefined, locale: Locale = 'en'): string {
  return now.toLocaleDateString(intlTag(locale), {
    timeZone: digestZone(zone),
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/** "November 9" — the daily digest subject. */
export function digestShortDate(now: Date, zone: string | null | undefined, locale: Locale = 'en'): string {
  return now.toLocaleDateString(intlTag(locale), { timeZone: digestZone(zone), month: 'long', day: 'numeric' })
}

/** "Today at 9:00 AM", "Tomorrow", "Fri, Nov 6 at 9:00 AM (2 days overdue)". */
export function digestDueText(
  due: Date,
  options: {
    now: Date
    zone: string | null | undefined
    isOverdue?: boolean
    isAllDay?: boolean
    locale?: Locale
    t?: NotificationTranslator
  },
): string {
  const zone = digestZone(options.zone)
  const locale = options.locale ?? 'en'
  const t = options.t ?? englishNotificationTranslator()
  // An all-day date is its UTC calendar day; a timed one is wherever its instant falls for the user.
  const dateZone = options.isAllDay ? 'UTC' : zone
  const diffDays = Math.round((dayIn(due, dateZone) - dayIn(options.now, zone)) / MS_PER_DAY)

  const dateString = due.toLocaleDateString(intlTag(locale), { timeZone: dateZone, weekday: 'short', month: 'short', day: 'numeric' })
  const time = options.isAllDay
    ? null
    : due.toLocaleTimeString(intlTag(locale), { timeZone: zone, ...clockOptions(locale) })
  const withTime = (bare: string) => (time === null ? bare : t('dates.dateAt', { date: bare, time }))

  if (options.isOverdue) return t('dates.overdueBy', { when: withTime(dateString), count: Math.abs(diffDays) })
  if (diffDays === 0) return time === null ? t('dates.today') : t('dates.todayAt', { time })
  if (diffDays === 1) return time === null ? t('dates.tomorrow') : t('dates.tomorrowAt', { time })
  if (diffDays === -1) return time === null ? t('dates.yesterday') : t('dates.yesterdayAt', { time })
  return withTime(dateString)
}

/** "Nov 8 - Nov 14" — the recipient's Sunday to Saturday containing `now`. */
export function digestWeekRange(now: Date, zone: string | null | undefined, locale: Locale = 'en'): string {
  const today = dayIn(now, digestZone(zone))
  const sunday = today - new Date(today).getUTCDay() * MS_PER_DAY
  const label = (ms: number) => new Date(ms).toLocaleDateString(intlTag(locale), { timeZone: 'UTC', month: 'short', day: 'numeric' })
  return `${label(sunday)} - ${label(sunday + 6 * MS_PER_DAY)}`
}
