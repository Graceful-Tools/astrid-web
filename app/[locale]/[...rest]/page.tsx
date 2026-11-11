import { notFound } from 'next/navigation'

/**
 * Every address under a locale that no page claims.
 *
 * Without this, an unknown address never reaches `app/[locale]/not-found.tsx`:
 * Next only renders that file when something inside `[locale]` calls
 * `notFound()`, and for an address that matches no route at all it falls back
 * to the root `app/not-found.tsx` — hardcoded English under `<html lang="en">`,
 * outside the locale layout. A German reader who mistyped an address got an
 * English page (AWTD-1575).
 *
 * This is next-intl's pattern for it: a catch-all that matches whatever is
 * left and calls `notFound()` from inside the locale, so the localized page
 * renders in the locale layout, in the request's language.
 */
export default function UnknownLocalizedPage() {
  notFound()
}
