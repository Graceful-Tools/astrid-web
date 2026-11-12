import { hasLocale } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { routing } from '@/lib/i18n/routing'
import { BRAND } from '@/lib/brand/config'
import { renderNotFoundDocument } from '@/lib/not-found-page'

/**
 * The localized 404 for an address under a locale that no route claims
 * (/de/zz, /fr/list/x/y). next.config.mjs routes it here with a FALLBACK
 * rewrite, which runs only after every page and dynamic route has missed
 * (AWTD-1599).
 *
 * Why a route handler and not app/not-found.tsx: on Vercel an unmatched address
 * is answered from the prerendered /404 with no function run, so a not-found
 * page can never see the request's locale. A handler runs per request, returns
 * the real 404 status, and sends a small document with no script. It boots no
 * app, unlike the [locale] catch-all of the first attempt (PR 717).
 */
type Context = { params: Promise<{ locale: string }> }

export async function GET(_request: Request, { params }: Context) {
  const requested = (await params).locale
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale
  const t = await getTranslations({ locale, namespace: 'errorPages' })

  const html = renderNotFoundDocument({
    locale,
    appName: BRAND.appName,
    title: t('notFoundTitle'),
    description: t('notFoundDescription'),
    goHome: t('notFoundGoHome'),
    homeHref: locale === routing.defaultLocale ? '/' : `/${locale}`,
  })

  return new Response(html, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // A miss is a miss for everyone. Let the CDN hold it briefly so bots
      // probing addresses don't each cost a function run.
      'Cache-Control': 'public, max-age=0, s-maxage=3600',
    },
  })
}
