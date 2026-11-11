import { fillMessage } from "@/components/shared/RichMessage"

type Translate = (key: string, replacements?: Record<string, string>) => string

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** [every one, every N] message keys for each unit the editor ('days') or the API ('daily') may send. */
const EVERY_KEYS: Record<string, [string, string]> = {
  days: ['repeating.summary.everyDay', 'repeating.summary.everyDays'],
  daily: ['repeating.summary.everyDay', 'repeating.summary.everyDays'],
  weeks: ['repeating.summary.everyWeek', 'repeating.summary.everyWeeks'],
  weekly: ['repeating.summary.everyWeek', 'repeating.summary.everyWeeks'],
  months: ['repeating.summary.everyMonth', 'repeating.summary.everyMonths'],
  monthly: ['repeating.summary.everyMonth', 'repeating.summary.everyMonths'],
  years: ['repeating.summary.everyYear', 'repeating.summary.everyYears'],
  yearly: ['repeating.summary.everyYear', 'repeating.summary.everyYears'],
}

function ordinalSuffix(num: number): string {
  const j = num % 10
  const k = num % 100
  if (j === 1 && k !== 11) return 'st'
  if (j === 2 && k !== 12) return 'nd'
  if (j === 3 && k !== 13) return 'rd'
  return 'th'
}

/**
 * One line describing a custom repeat pattern ("Every 2 weeks on Mon, Wed, Fri,
 * ends after 3 occurrences"), in the reader's language. Moved out of
 * TaskFieldEditors, which is at its line ceiling. Day and month names come
 * from Intl; only English writes ordinals ("15th").
 */
export function customRepeatingSummary(
  repeatingData: any,
  repeatFrom: "DUE_DATE" | "COMPLETION_DATE" | undefined,
  t: Translate,
  locale: string = 'en',
): string {
  if (!repeatingData) return ''

  // CustomRepeatingEditor uses 'unit' (days/weeks/months/years)
  // Support both 'unit' and 'frequency' for compatibility
  const { unit, frequency, interval, weekdays, monthDay, month, endCondition, endAfterOccurrences, endUntilDate } = repeatingData

  // Default interval to 1 if not provided
  const actualInterval = interval || 1
  const repeatUnit = unit || frequency
  const english = locale === 'en'
  const dayOfMonth = (day: number) => (english ? `${day}${ordinalSuffix(day)}` : String(day))

  const everyKeys = EVERY_KEYS[repeatUnit]
  let summary = everyKeys
    ? actualInterval > 1 ? t(everyKeys[1], { count: String(actualInterval) }) : t(everyKeys[0])
    // Fallback for unknown unit/frequency
    : fillMessage(t('repeating.summary.everyOther'), {
        interval: actualInterval > 1 ? `${actualInterval} ` : '',
        unit: String(repeatUnit || 'unknown'),
      })

  if ((repeatUnit === 'weeks' || repeatUnit === 'weekly') && weekdays && weekdays.length > 0) {
    const weekdayName = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
    const days = weekdays.map((day: string | number) => {
      // Handle both numeric indices and string day names
      const index = typeof day === 'number' ? day : WEEKDAYS.indexOf(day.toLowerCase())
      if (index >= 0 && index < 7) return weekdayName.format(new Date(Date.UTC(2023, 0, 1 + index))) // 1 Jan 2023 was a Sunday
      return typeof day === 'number' ? undefined : day.charAt(0).toUpperCase() + day.slice(1, 3)
    }).join(', ')
    summary = fillMessage(t('repeating.summary.onDays'), { summary, days })
  } else if ((repeatUnit === 'months' || repeatUnit === 'monthly') && monthDay) {
    summary = fillMessage(t('repeating.summary.onDayOfMonth'), { summary, day: dayOfMonth(monthDay) })
  } else if ((repeatUnit === 'years' || repeatUnit === 'yearly') && month !== undefined && monthDay) {
    const sample = new Date(Date.UTC(2024, month - 1, english ? 1 : monthDay))
    const date = english
      ? `${new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(sample)} ${dayOfMonth(monthDay)}`
      : new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(sample)
    summary = fillMessage(t('repeating.summary.onDate'), { summary, date })
  }

  // Add end condition information
  if (endCondition === 'after_occurrences' && endAfterOccurrences) {
    summary = fillMessage(
      t(endAfterOccurrences > 1 ? 'repeating.summary.endsAfterMany' : 'repeating.summary.endsAfterOne'),
      { summary, count: String(endAfterOccurrences) },
    )
  } else if (endCondition === 'until_date' && endUntilDate) {
    const until = endUntilDate instanceof Date ? endUntilDate : new Date(endUntilDate)
    const date = until.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
    summary = fillMessage(t('repeating.summary.until'), { summary, date })
  }

  // Add "from due date" suffix if using DUE_DATE mode (COMPLETION_DATE is default)
  if (repeatFrom === 'DUE_DATE') {
    summary = fillMessage(t('repeating.summary.fromDueDate'), { summary })
  }

  return summary
}
