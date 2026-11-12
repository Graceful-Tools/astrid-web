/**
 * The date-fns locale for an app locale, for the calendar's month and weekday
 * names (react-day-picker takes a date-fns `Locale`) — AWTD-1601.
 * English is the library default, so it gets undefined.
 */
import type { Locale } from 'date-fns'
import { de, es, fr, it, ja, ko, nl, pt, ru, zhCN, zhTW } from 'date-fns/locale'

const LOCALES: Record<string, Locale> = {
  de,
  es,
  fr,
  it,
  ja,
  ko,
  nl,
  pt,
  ru,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
}

export function dateFnsLocaleFor(locale?: string | null): Locale | undefined {
  return locale ? LOCALES[locale] : undefined
}
