import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'

import { BRAND } from '@/lib/brand/config'

/**
 * Root-level not-found page: every address that matches no route, under a
 * locale or not (/de/nope, /nope, /nope.png).
 * Must include html/body tags since it's outside the locale layout.
 *
 * It stays outside the locale layout on purpose: server-rendered, a few KB,
 * and it boots no app. Rendering misses inside [locale] (PR #717) made every
 * 404 an empty client-rendered shell ~16x the size that fired API calls for a
 * signed-out visitor. It speaks the request's language instead: the
 * middleware forwards the locale next-intl resolved, and the copy is the
 * shared errorPages strings (AWTD-1599).
 */
export default async function NotFound() {
  const locale = await getLocale()
  const t = await getTranslations('errorPages')
  return (
    <html lang={locale}>
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem'
        }}>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: '3.75rem', fontWeight: 'bold', color: '#fff', marginBottom: '1rem' }}>404</h1>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', color: '#d1d5db', marginBottom: '1rem' }}>{t('notFoundTitle')}</h2>
            <p style={{ color: '#9ca3af', marginBottom: '2rem' }}>
              {t('notFoundDescription')}
            </p>
            <Link
              href="/"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.75rem 1.5rem',
                backgroundColor: BRAND.accentColor,
                color: '#fff',
                fontWeight: '500',
                borderRadius: '0.75rem',
                textDecoration: 'none',
                transition: 'background-color 0.2s'
              }}
            >
              {t('notFoundGoHome')}
            </Link>
          </div>
        </div>
      </body>
    </html>
  )
}
