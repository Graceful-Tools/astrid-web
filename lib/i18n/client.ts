// Client-side i18n utilities
// Uses next-intl's provider (messages loaded server-side, no async flash)
'use client'

import { useLocale as useNextIntlLocale, useMessages } from 'next-intl'

// Get current locale from next-intl (synchronous, no flash)
export function useLocale() {
  return useNextIntlLocale()
}

// Translation hook that reads from NextIntlClientProvider (synchronous)
export function useTranslations() {
  const locale = useNextIntlLocale()
  const messages = useMessages()

  // Navigate nested keys (e.g., "reminders.general")
  const t = (key: string, replacements?: Record<string, string>): string => {
    if (!messages) return key

    const keys = key.split('.')
    let value: any = messages

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k]
      } else {
        return key
      }
    }

    // Handle replacements like {name}
    if (typeof value === 'string' && replacements) {
      return Object.entries(replacements).reduce(
        (str, [key, val]) => str.replace(`{${key}}`, val),
        value
      )
    }

    return typeof value === 'string' ? value : key
  }

  // Get array of translations
  const tArray = (key: string): string[] => {
    if (!messages) return []

    const keys = key.split('.')
    let value: any = messages

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k]
      } else {
        return []
      }
    }

    return Array.isArray(value) ? value : []
  }

  return { t, tArray, locale, messages }
}
