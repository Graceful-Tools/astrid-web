import type { CSSProperties } from 'react'
import { escapeEmailHtml } from '@/lib/email-html'
import { BRAND } from '@/lib/brand/config'

/**
 * The bare 404 page, shared by its two renderers (AWTD-1599).
 *
 * - `app/not-found.tsx` (React): the build-time page. It must stay STATIC. On
 *   Vercel every address no route matches is answered from the prerendered
 *   `/404` without running a function, so a not-found that reads the request
 *   (getLocale, headers) is never prerendered and Vercel falls back to Next's
 *   unbranded default "404: This page could not be found". That shipped in
 *   c888bddc. It speaks the default locale.
 * - `app/missing/[locale]/route.ts` (string): the localized page. A fallback
 *   rewrite in next.config.mjs sends a miss under a locale (/de/zz) there.
 *   It runs on the server and returns a 404 status.
 *
 * One look, one place: both read these styles.
 */
export const NOT_FOUND_STYLES = {
  body: { margin: 0, fontFamily: 'system-ui, sans-serif' },
  shell: {
    minHeight: '100vh',
    backgroundColor: '#000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem',
  },
  center: { textAlign: 'center' },
  code: { fontSize: '3.75rem', fontWeight: 'bold', color: '#fff', marginBottom: '1rem' },
  title: { fontSize: '1.5rem', fontWeight: '600', color: '#d1d5db', marginBottom: '1rem' },
  description: { color: '#9ca3af', marginBottom: '2rem' },
  home: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.75rem 1.5rem',
    // The brand's accent, so a partner's 404 is theirs and not Astrid blue.
    backgroundColor: BRAND.accentColor,
    color: '#fff',
    fontWeight: '500',
    borderRadius: '0.75rem',
    textDecoration: 'none',
    transition: 'background-color 0.2s',
  },
} satisfies Record<string, CSSProperties>

/** `{ minHeight: '100vh' }` → `min-height:100vh` */
function cssText(style: CSSProperties): string {
  return Object.entries(style)
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${value}`)
    .join(';')
}

export interface NotFoundCopy {
  locale: string
  appName: string
  title: string
  description: string
  goHome: string
  homeHref: string
}

/** The localized 404 as a whole document: no script, nothing to hydrate. */
export function renderNotFoundDocument(copy: NotFoundCopy): string {
  const e = escapeEmailHtml
  const s = NOT_FOUND_STYLES
  return (
    '<!DOCTYPE html>' +
    `<html lang="${e(copy.locale)}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    `<title>${e(copy.title)} | ${e(copy.appName)}</title></head>` +
    `<body style="${cssText(s.body)}"><div style="${cssText(s.shell)}"><div style="${cssText(s.center)}">` +
    `<h1 style="${cssText(s.code)}">404</h1>` +
    `<h2 style="${cssText(s.title)}">${e(copy.title)}</h2>` +
    `<p style="${cssText(s.description)}">${e(copy.description)}</p>` +
    `<a href="${e(copy.homeHref)}" style="${cssText(s.home)}">${e(copy.goHome)}</a>` +
    '</div></div></body></html>'
  )
}
