/**
 * AWTD-1599 — the middleware half of "a missing file address answers 200 with
 * the app, and the 404 page is always English".
 *
 * Two facts the fix is built on, pinned here so a later change to the matcher
 * or to next-intl cannot quietly undo it:
 *
 * 1. File-shaped addresses never reach the middleware. The matcher skips
 *    .png/.md/favicon/apple-touch-icon so the middleware does not run on every
 *    static file — and it runs before the filesystem, so it could not tell a
 *    missing file from a real one anyway. So `/nope.png` is NOT routed by
 *    next-intl; it fell through to `app/[locale]` with `locale = "nope.png"` and
 *    rendered the app shell with a 200. Its 404 comes from an afterFiles rewrite
 *    in next.config.mjs instead (bottom of this file), which runs only once
 *    public/ has found nothing.
 *
 * 2. For a page address the middleware does run, and next-intl hands the
 *    request's locale to the server render as a request header. The root
 *    not-found page reads it to answer `/de/nope` in German under lang="de".
 */
import { describe, it, expect, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { BRAND } from '@/lib/brand/config'

// The real next-intl middleware cannot load under vitest (its ESM build imports
// `next/server` without an extension). Stand in for it with the one thing the
// root 404 relies on: it forwards the locale as the x-next-intl-locale request
// header. The production-build check on the task measures the real thing.
const intl = vi.hoisted(() => ({ seen: [] as string[] }))
vi.mock('next-intl/middleware', () => ({
  default: (routing: { locales: readonly string[]; defaultLocale: string }) => (request: NextRequest) => {
    intl.seen.push(request.nextUrl.pathname)
    const first = request.nextUrl.pathname.split('/')[1]
    const locale = routing.locales.includes(first) ? first : routing.defaultLocale
    const headers = new Headers(request.headers)
    headers.set('x-next-intl-locale', locale)
    return NextResponse.next({ request: { headers } })
  },
}))

const { middleware, config } = await import('@/middleware')

const ORIGIN = `https://www.${BRAND.domain}`

/** Next compiles the matcher with path-to-regexp; the source is one anchored group. */
function matcherRuns(pathname: string): boolean {
  return config.matcher.some((source) => new RegExp(`^${source}$`).test(pathname))
}

/** The locale next-intl forwarded to the render, if any. */
function forwardedLocale(res: Response): string | null {
  return res.headers.get('x-middleware-request-x-next-intl-locale')
}

describe('AWTD-1599: missing addresses and the middleware', () => {
  it.each(['/nope.png', '/nope.md', '/apple-touch-icon-precomposed.png', '/favicon-64x64.png'])(
    'never runs on a file-shaped address like %s (so its 404 cannot come from here)',
    (pathname) => {
      expect(matcherRuns(pathname)).toBe(false)
    },
  )

  it.each(['/nope', '/de/nope', '/settings', '/de/settings', '/api/health', '/.well-known/apple-app-site-association'])(
    'still runs on %s',
    (pathname) => {
      expect(matcherRuns(pathname)).toBe(true)
    },
  )

  it('hands a miss under /de to next-intl, whose locale header the root 404 renders in', () => {
    const res = middleware(new NextRequest(new URL('/de/nope', ORIGIN)))
    expect(intl.seen).toContain('/de/nope')
    expect(res.status).toBeLessThan(300)
    expect(forwardedLocale(res)).toBe('de')
  })

  it('forwards the default locale for an unprefixed miss', () => {
    const res = middleware(new NextRequest(new URL('/nope', ORIGIN)))
    expect(forwardedLocale(res)).toBe('en')
  })
})

describe('AWTD-1599: a missing root-level file is rewritten to the 404, after the filesystem', () => {
  type Rewrite = { source: string; destination: string }

  async function missingFileRule(): Promise<Rewrite> {
    const { default: nextConfig } = await import('@/next.config.mjs')
    const rewrites = (await nextConfig.rewrites()) as Rewrite[] | { afterFiles?: Rewrite[] }
    // An array is Next's afterFiles phase: after public/ and static routes, before [locale].
    expect(Array.isArray(rewrites)).toBe(true)
    const rule = (rewrites as Rewrite[]).find((r) => r.destination.endsWith('/_missing-file'))
    expect(rule).toBeDefined()
    return rule!
  }

  async function rewrites(pathname: string): Promise<boolean> {
    const { getPathMatch } = await import('next/dist/shared/lib/router/utils/path-match')
    const rule = await missingFileRule()
    return getPathMatch(rule.source, { removeUnnamedParams: true, strict: true })(pathname) !== false
  }

  it.each(['/nope.png', '/nope.md', '/apple-touch-icon-precomposed.png', '/robots.txt'])(
    'catches %s, which no file in public/ answered',
    async (pathname) => {
      expect(await rewrites(pathname)).toBe(true)
    },
  )

  it.each(['/', '/de', '/zh-TW', '/settings', '/de/nope', '/icons/missing.png', '/api/v1/tasks/abc.json', '/.well-known/x'])(
    'leaves %s alone (a locale, a page, or deeper than the root)',
    async (pathname) => {
      expect(await rewrites(pathname)).toBe(false)
    },
  )

  it('points at a locale-prefixed address no page claims, so the root not-found answers', async () => {
    const rule = await missingFileRule()
    const [, locale, rest] = rule.destination.split('/')
    expect(['en']).toContain(locale)
    expect(existsSync(join(process.cwd(), 'app/[locale]', rest))).toBe(false)
  })
})
