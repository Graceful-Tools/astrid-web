"use client"

import { useEffect } from "react"
import { useLocale } from "next-intl"
import { useSession } from "next-auth/react"
import { apiPut } from "@/lib/api"

/** Per browser: the `${userId}:${locale}` last reported, so a page load costs no request. */
export const LOCALE_REPORTED_KEY = "astrid.localeReported"

function readReported(): string | null {
  try {
    return window.localStorage.getItem(LOCALE_REPORTED_KEY)
  } catch {
    return null
  }
}

function writeReported(value: string): void {
  try {
    window.localStorage.setItem(LOCALE_REPORTED_KEY, value)
  } catch {
    // Storage blocked: the next page load reports again, which is harmless.
  }
}

/**
 * Tells the server which language a signed-in user reads (AWTD-1592).
 *
 * Push notifications and reminder emails are rendered by jobs with no request to
 * take a language from, so they read `User.locale`. Web has no language picker —
 * the language is the address (`/de/…`) or next-intl's detection — so the page's
 * own locale is the best evidence there is, and it is reported whenever it
 * differs from the last one this browser sent for this user.
 */
export function LocaleSync() {
  const locale = useLocale()
  const { data: session, status } = useSession()
  const userId = session?.user?.id

  useEffect(() => {
    if (status !== "authenticated" || !userId) return
    const marker = `${userId}:${locale}`
    if (readReported() === marker) return

    let cancelled = false
    apiPut("/api/v1/users/me/settings", { locale })
      .then((response) => {
        if (!cancelled && response.ok) writeReported(marker)
      })
      .catch(() => {
        // Best effort: an unreported language means English notifications, as before.
      })
    return () => {
      cancelled = true
    }
  }, [locale, status, userId])

  return null
}
