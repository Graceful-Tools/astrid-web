import Link from 'next/link'
import { connection } from 'next/server'
import { getTranslations } from 'next-intl/server'
import { routing } from '@/lib/i18n/routing'
import { NOT_FOUND_STYLES as s } from '@/lib/not-found-page'
import { isRuntimeBrandBuild } from '@/lib/brand/runtime-env'

/**
 * Root-level not-found page: the build-time 404, outside the locale layout,
 * so it includes html/body tags.
 *
 * It MUST stay static: no getLocale(), no headers(). On Vercel an unmatched
 * address is answered from this page prerendered as /404, without running a
 * function. When it read the request's locale, it was not prerendered, and
 * production served Next's unbranded default 404 instead (AWTD-1599, c888bddc).
 * Locale misses get their own localized page from app/missing/[locale]/route.ts
 * through a fallback rewrite. This one speaks the default locale.
 *
 * The one exception is the same as in app/[locale]/layout.tsx. An image that
 * takes its brand at runtime (the self-hosted image, AWTD-1587) must render
 * per request, or this page would carry the build's accent and name. Hosted
 * Astrid is not such a build, so on Vercel the page stays prerendered.
 */
export default async function NotFound() {
  if (isRuntimeBrandBuild()) await connection()
  const locale = routing.defaultLocale
  const t = await getTranslations({ locale, namespace: 'errorPages' })
  return (
    <html lang={locale}>
      <body style={s.body}>
        <div style={s.shell}>
          <div style={s.center}>
            <h1 style={s.code}>404</h1>
            <h2 style={s.title}>{t('notFoundTitle')}</h2>
            <p style={s.description}>{t('notFoundDescription')}</p>
            <Link href="/" style={s.home}>
              {t('notFoundGoHome')}
            </Link>
          </div>
        </div>
      </body>
    </html>
  )
}
