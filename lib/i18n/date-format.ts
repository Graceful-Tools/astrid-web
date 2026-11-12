/**
 * Dates and times in the reader's language (AWTD-1601).
 *
 * Every date a person reads in the app used to be spelt by hand in English —
 * `format(d, "MMM d 'at' h:mm a")`, `toLocaleDateString('en-US')`, a "5pm"
 * built from `getHours()`. A German reader saw "Nov 14, 2026 9:30 AM". These
 * ask `Intl` with the active locale instead, and take the relative words
 * ("Today", "at") from the locale files.
 *
 * English output is unchanged from what the hand-written formats produced, so
 * an English reader sees no difference ("Nov 14, 2026", "9:30 AM", "5pm").
 */

type Translate = (key: string, replacements?: Record<string, string>) => string

export const DEFAULT_DATE_LOCALE = 'en-US'

/** The app's locale codes are BCP 47 already; English keeps US forms (month first, 12-hour). */
export function intlLocale(locale?: string | null): string {
  if (!locale || locale === 'en') return DEFAULT_DATE_LOCALE
  return locale
}

function isEnglish(locale?: string | null): boolean {
  return intlLocale(locale).startsWith('en')
}

/** "Nov 14, 2026" / "14. Nov. 2026" / "2026年11月14日". */
export function formatShortDate(date: Date, locale?: string | null, options: { timeZone?: string } = {}): string {
  return date.toLocaleDateString(intlLocale(locale), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...options,
  })
}

/** "Nov 14" / "14. Nov." — no year. */
export function formatMonthDay(date: Date, locale?: string | null): string {
  return date.toLocaleDateString(intlLocale(locale), { month: 'short', day: 'numeric' })
}

/** "9:30 AM" / "09:30" / "9:30". */
export function formatClockTime(date: Date, locale?: string | null): string {
  return date.toLocaleTimeString(intlLocale(locale), { hour: 'numeric', minute: '2-digit' })
}

/**
 * The compact time a field shows: "5pm", "5:30pm" in English (the app's own
 * spelling, kept), the locale's own short time elsewhere ("17:00").
 */
export function formatConciseClockTime(date: Date, locale?: string | null): string {
  if (isEnglish(locale)) {
    const hours = date.getHours()
    const minutes = date.getMinutes()
    const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
    const period = hours >= 12 ? 'pm' : 'am'
    const minuteStr = minutes === 0 ? '' : `:${minutes.toString().padStart(2, '0')}`
    return `${hour12}${minuteStr}${period}`
  }
  return formatClockTime(date, locale)
}

/** "Nov 11 at 4:24 AM" / "11. Nov. um 04:24". */
export function formatDateAtTime(date: Date, locale: string | null | undefined, t: Translate): string {
  const day = formatMonthDay(date, locale)
  const time = formatClockTime(date, locale)
  const phrase = t('time.dateAtTime', { date: day, time })
  return phrase && phrase !== 'time.dateAtTime' ? phrase : `${day} at ${time}`
}

/** A long date for a picker button: "November 14, 2026" / "14. November 2026". */
export function formatLongDate(date: Date, locale?: string | null): string {
  return date.toLocaleDateString(intlLocale(locale), { dateStyle: 'long' })
}

/** "in 1 day" / "in 1 Tag" / "1 日後" — a span from now, in whole days, hours or minutes. */
export function formatRelativeFromNow(ms: number, locale?: string | null): string {
  const format = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'always' })
  const minutes = Math.round(ms / 60000)
  if (Math.abs(minutes) >= 1440) return format.format(Math.round(minutes / 1440), 'day')
  if (Math.abs(minutes) >= 60) return format.format(Math.round(minutes / 60), 'hour')
  return format.format(minutes, 'minute')
}
