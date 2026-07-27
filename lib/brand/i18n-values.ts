/**
 * Brand interpolation for i18n messages.
 *
 * Translated copy refers to the product as `{appName}` rather than a hardcoded "Astrid",
 * so a fork rebrands without touching 12 locale files. next-intl v4 removed
 * `defaultTranslationValues`, so instead of asking every `t()` call site to pass the
 * value, we substitute the token once when messages are loaded.
 *
 * Substitution happens *before* ICU parsing, so `{appName}` never reaches the formatter
 * and cannot collide with real ICU arguments (`{count}`, `{name}`, …), which are left
 * untouched. Apply this in every place messages enter the app:
 *   - lib/i18n/request.ts       (server + client, via NextIntlClientProvider)
 *   - lib/reminder-constants.ts (reminder/notification copy)
 *   - tests/setup.ts            (test render provider)
 */

import { BRAND } from './config'

/** Tokens replaced in message strings. Keys are the bare names, without braces. */
const BRAND_TOKENS: Record<string, string> = {
  appName: BRAND.appName,
  brandDomain: BRAND.domain,
  supportEmail: BRAND.supportEmail,
  inboundTaskEmail: BRAND.inboundTaskEmail,
}

const TOKEN_PATTERN = new RegExp(`\\{(${Object.keys(BRAND_TOKENS).join('|')})\\}`, 'g')

/** Substitute brand tokens in a single string. */
export function applyBrandToString(value: string): string {
  // Fast path: most strings contain no token at all.
  if (!value.includes('{')) return value
  return value.replace(TOKEN_PATTERN, (match, token: string) => BRAND_TOKENS[token] ?? match)
}

/**
 * Deep-substitute brand tokens across a messages tree.
 *
 * Returns a new object; the input (an imported JSON module, which is frozen in some
 * bundlers) is never mutated.
 */
export function applyBrandToMessages<T>(messages: T): T {
  if (typeof messages === 'string') {
    return applyBrandToString(messages) as unknown as T
  }
  if (Array.isArray(messages)) {
    return messages.map((entry) => applyBrandToMessages(entry)) as unknown as T
  }
  if (messages && typeof messages === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(messages as Record<string, unknown>)) {
      out[key] = applyBrandToMessages(value)
    }
    return out as unknown as T
  }
  return messages
}
