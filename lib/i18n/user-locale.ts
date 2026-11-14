/**
 * The language a user reads, for copy rendered with no request to take one from
 * (AWTD-1592): push notifications, the service worker's own toasts, and the
 * reminder and digest emails. Pages get their language from the address and
 * next-intl; a cron job sending a reminder has neither, so it reads `User.locale`.
 *
 * Written from two places, both through {@link normalizeLocale}:
 *   - the web app, which reports the signed-in page's locale when it changes
 *     (components/locale-sync.tsx), and
 *   - any client, through PUT /api/v1/users/me/settings `{ locale }` — which is
 *     how a native app sends its device language.
 *
 * Unknown or missing reads as English, which is what every one of these
 * messages said before the column existed.
 */
import { createTranslator } from 'next-intl'
import type { PrismaClient } from '@prisma/client'
import { defaultLocale, locales, type Locale } from './config'
import { applyBrandToMessages } from '@/lib/brand/i18n-values'
import englishMessages from './locales/en.json'

const LOCALE_SET = new Set<string>(locales)

/** Apple and Android name Chinese by script; the app names it by region. */
const CHINESE_BY_SCRIPT: Record<string, Locale> = {
  hans: 'zh-CN',
  hant: 'zh-TW',
}
const CHINESE_BY_REGION: Record<string, Locale> = {
  cn: 'zh-CN',
  sg: 'zh-CN',
  tw: 'zh-TW',
  hk: 'zh-TW',
  mo: 'zh-TW',
}

/**
 * One of the app's twelve locales, from a BCP 47 tag as a browser or a device
 * spells it (`de-DE`, `pt_BR`, `zh-Hant-HK`), or null when it is none of them.
 * Null is not English: the caller decides whether to store nothing.
 */
export function normalizeLocale(input: unknown): Locale | null {
  if (typeof input !== 'string') return null
  const tag = input.trim().replace(/_/g, '-')
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(tag)) return null

  const [language, ...rest] = tag.toLowerCase().split('-')
  if (language === 'zh') {
    for (const part of rest) {
      const match = CHINESE_BY_SCRIPT[part] ?? CHINESE_BY_REGION[part]
      if (match) return match
    }
    return 'zh-CN'
  }
  return LOCALE_SET.has(language) ? (language as Locale) : null
}

/** The stored value as a locale to render in: English when unknown. */
export function renderLocale(stored: string | null | undefined): Locale {
  return normalizeLocale(stored) ?? defaultLocale
}

/** Every locale has en.json's shape (tests/i18n/key-parity.test.ts), so keys are checked against it. */
type NotificationMessages = typeof import('./locales/en.json')

const messagesCache = new Map<Locale, Promise<NotificationMessages>>()

/** All of a locale's messages, brand applied — what the reminder quotes read from. */
export function loadMessages(locale: Locale): Promise<NotificationMessages> {
  let cached = messagesCache.get(locale)
  if (!cached) {
    cached = import(`./locales/${locale}.json`).then(
      (module) => applyBrandToMessages(module.default) as NotificationMessages,
    )
    messagesCache.set(locale, cached)
  }
  return cached
}

/**
 * A translator over the `notifications` key group, in the given stored locale.
 * A key missing from that locale falls back to the English string rather than
 * printing its own name (the key-parity test keeps that from happening, but a
 * notification is the wrong place to find out).
 */
export async function getNotificationTranslator(stored: string | null | undefined) {
  const locale = renderLocale(stored)
  const [messages, english] = await Promise.all([loadMessages(locale), loadMessages(defaultLocale)])
  const englishT = createTranslator({ locale: defaultLocale, messages: english, namespace: 'notifications' })
  return createTranslator({
    locale,
    messages,
    namespace: 'notifications',
    onError: () => {},
    getMessageFallback: ({ key }) => englishT(key as Parameters<typeof englishT>[0]),
  })
}

export type NotificationTranslator = Awaited<ReturnType<typeof getNotificationTranslator>>

let english: NotificationTranslator | null = null

/**
 * The English translator, synchronously — the default for code paths that have
 * no user to ask (and for the email builders' existing callers). Built from the
 * same en.json, so its output is the English the async translator gives.
 */
export function englishNotificationTranslator(): NotificationTranslator {
  english ??= createTranslator({
    locale: defaultLocale,
    messages: applyBrandToMessages(englishMessages) as NotificationMessages,
    namespace: 'notifications',
  })
  return english
}

/** The recipient's language and a translator for it, in one read. */
export async function getUserNotificationTranslator(
  prisma: Pick<PrismaClient, 'user'>,
  userId: string,
): Promise<{ locale: Locale; t: NotificationTranslator }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { locale: true } })
  const locale = renderLocale(user?.locale)
  return { locale, t: await getNotificationTranslator(locale) }
}

/**
 * The tag to hand `Intl` for a rendered locale. English stays `en-US`, which is
 * what these messages formatted with before, so an English reader's "5:00 PM"
 * and "Mon, Nov 9" are unchanged.
 */
export function intlTag(locale: Locale): string {
  return locale === 'en' ? 'en-US' : locale
}

/** A clock time as the reader writes one: "5:00 PM" in English, "17:00" in German. */
export function clockOptions(locale: Locale): Intl.DateTimeFormatOptions {
  return locale === 'en'
    ? { hour: 'numeric', minute: '2-digit', hour12: true }
    : { hour: 'numeric', minute: '2-digit' }
}
