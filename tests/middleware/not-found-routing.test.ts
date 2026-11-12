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

  // Copilot on #723: /de/nope.png rendered the 404 in English, because the
  // matcher skipped it and nothing forwarded "de". No real file lives under a
  // locale prefix (public/ has no en/, de/ ... folders), so running the
  // middleware there costs no static request anything.
  it.each(['/de/nope.png', '/fr/nope.md', '/zh-TW/icons/x.png', '/ja/favicon.ico', '/en/vendor/x.js'])(
    'runs on the locale-prefixed file miss %s, so the 404 gets its locale',
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

describe('AWTD-1599: the matcher spells out the locales', () => {
  it('names exactly the configured locales (a matcher must be a literal, so it cannot import them)', async () => {
    const { locales } = await import('@/lib/i18n/config')
    const spelled = config.matcher[0].match(/\(\?!\(\?:([^)]*)\)\//)?.[1]?.split('|')
    expect(spelled?.slice().sort()).toEqual([...locales].sort())
  })

  it('no public/ folder shares a locale name, so no real file is under a locale prefix', async () => {
    const { locales } = await import('@/lib/i18n/config')
    for (const locale of locales) expect(existsSync(join(process.cwd(), 'public', locale))).toBe(false)
  })
})

type Rewrite = { source: string; destination: string }
type Phases = { beforeFiles?: Rewrite[]; afterFiles?: Rewrite[]; fallback?: Rewrite[] }

async function rewritePhases(): Promise<Phases> {
  const { default: nextConfig } = await import('@/next.config.mjs')
  const rewrites = (await nextConfig.rewrites!()) as Rewrite[] | Phases
  expect(Array.isArray(rewrites)).toBe(false)
  return rewrites as Phases
}

/** Where `rule` sends `pathname`, or null when it does not match. */
async function rewriteTo(rule: Rewrite, pathname: string): Promise<string | null> {
  const { getPathMatch } = await import('next/dist/shared/lib/router/utils/path-match')
  const params = getPathMatch(rule.source, { removeUnnamedParams: true, strict: true })(pathname)
  if (params === false) return null
  return rule.destination.replace(/:(\w+)/g, (_, name: string) => String(params[name]))
}

const HANDLER = join(process.cwd(), 'app/missing/[locale]/route.ts')

describe('AWTD-1599: a missing root-level file is rewritten to the 404, after the filesystem', () => {
  async function missingFileRule(): Promise<Rewrite> {
    // afterFiles: after public/ and static routes, before [locale].
    const rule = (await rewritePhases()).afterFiles?.find((r) => r.source.includes('\\.'))
    expect(rule).toBeDefined()
    return rule!
  }

  it.each(['/nope.png', '/nope.md', '/apple-touch-icon-precomposed.png', '/robots.txt'])(
    'sends %s, which no file in public/ answered, to the 404 handler in the default locale',
    async (pathname) => {
      expect(await rewriteTo(await missingFileRule(), pathname)).toBe('/missing/en')
    },
  )

  it.each(['/', '/de', '/zh-TW', '/settings', '/de/nope', '/icons/missing.png', '/api/v1/tasks/abc.json', '/.well-known/x'])(
    'leaves %s alone (a locale, a page, or deeper than the root)',
    async (pathname) => {
      expect(await rewriteTo(await missingFileRule(), pathname)).toBeNull()
    },
  )

  it('points at a route that exists', () => {
    expect(existsSync(HANDLER)).toBe(true)
  })
})

describe('AWTD-1599: a miss under a locale falls back to the localized 404 handler', () => {
  // On Vercel an unmatched address is served from the prerendered /404 with no
  // function run, so app/not-found.tsx can never see the locale. The fallback
  // phase runs after every page and dynamic route missed, and sends the miss
  // to a handler that can.
  async function fallbackRule(): Promise<Rewrite> {
    const rule = (await rewritePhases()).fallback?.find((r) => r.destination.startsWith('/missing/'))
    expect(rule).toBeDefined()
    return rule!
  }

  it.each([
    ['/de/zz', '/missing/de'],
    ['/fr/list/x/y/z', '/missing/fr'],
    ['/zh-TW/nope.md', '/missing/zh-TW'],
    ['/en/zz', '/missing/en'],
    ['/zz/nope', '/missing/zz'], // not a locale: the handler answers in the default one
  ])('sends %s to %s', async (pathname, destination) => {
    expect(await rewriteTo(await fallbackRule(), pathname)).toBe(destination)
  })

  it.each(['/api/nope/x', '/_next/static/x.js', '/.well-known/x', '/de', '/zz'])(
    'leaves %s alone',
    async (pathname) => {
      expect(await rewriteTo(await fallbackRule(), pathname)).toBeNull()
    },
  )
})
