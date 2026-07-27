import { getRequestConfig } from 'next-intl/server'
import { routing } from './routing'
import { applyBrandToMessages } from '@/lib/brand/i18n-values'

export default getRequestConfig(async ({ requestLocale }) => {
  // Get locale from request (set by middleware)
  let locale = await requestLocale

  // Validate that the incoming locale is valid, fallback to default
  if (!locale || !routing.locales.includes(locale as any)) {
    locale = routing.defaultLocale
  }

  return {
    locale,
    // Copy says `{appName}` rather than a hardcoded product name; substitute the brand
    // before the messages reach the ICU formatter. See lib/brand/i18n-values.ts.
    messages: applyBrandToMessages((await import(`./locales/${locale}.json`)).default)
  }
})
