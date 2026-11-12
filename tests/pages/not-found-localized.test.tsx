/**
 * AWTD-1599: "A missing file address answers 200 with the app, and the 404 page
 * is always English".
 *
 * 1. /de/nope rendered the root app/not-found.tsx — hardcoded English under
 *    <html lang="en">. A miss under a locale matches no route, so Next never
 *    enters app/[locale] and its localized not-found is unreachable. The root
 *    page is the right one to serve (server-rendered, ~8 KB, boots no app);
 *    it just has to speak the request's language. The first attempt (PR #717)
 *    instead routed every miss through a [locale] catch-all, which wrapped the
 *    404 in the full app layout: empty until JavaScript ran, ~16x heavier, and
 *    a signed-out miss fired API calls.
 *
 * 2. /nope.png never reaches the middleware (tests/middleware/not-found-routing.test.ts),
 *    so it landed in app/[locale] with locale "nope.png" and rendered the app
 *    shell with a 200 under <html lang="nope.png">. A next.config afterFiles
 *    rewrite now sends a missing root-level file to the root 404 (tested next
 *    to the middleware). The locale layout is the backstop for anything deeper
 *    (/icons/list/x): a non-locale segment calls notFound() before any message
 *    is loaded, so it is at least a 404 rather than the app with a 200.
 */
/*
 * Follow-up (c888bddc on Vercel): the localized root page came out as Next's
 * unbranded default 404 in production. Vercel answers an unmatched address
 * from the prerendered /404 without running a function, and a not-found that
 * reads the request locale is not prerendered. So app/not-found.tsx is static
 * again (default locale), and a miss under a locale goes to the
 * app/missing/[locale] handler through a fallback rewrite.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type React from 'react'
import { getMessages } from 'next-intl/server'
import de from '@/lib/i18n/locales/de.json'
import en from '@/lib/i18n/locales/en.json'

const MESSAGES = { de, en } as const
const nextIntl = vi.hoisted(() => ({ locale: 'en' as 'de' | 'en' }))

vi.mock('next-intl/server', () => ({
  // Reading the request's locale is what made the root page dynamic.
  getLocale: vi.fn(async () => {
    throw new Error('getLocale() makes app/not-found.tsx dynamic, and Vercel then serves the default 404')
  }),
  getTranslations: vi.fn(async (arg: string | { locale: string; namespace: string }) => {
    const { locale, namespace } =
      typeof arg === 'string' ? { locale: nextIntl.locale, namespace: arg } : arg
    const table = (MESSAGES[locale as keyof typeof MESSAGES] as unknown as Record<string, Record<string, string>>)[namespace]
    return (key: string) => table[key]
  }),
  getMessages: vi.fn(async () => ({})),
  setRequestLocale: vi.fn(),
}))

const connection = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('next/server', async (orig) => ({ ...(await orig<object>()), connection }))

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;404')
  }),
)
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), notFound }))
vi.mock('next/font/google', () => ({ Inter: () => ({ className: 'inter' }) }))
vi.mock('@/components/providers', () => ({ Providers: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/components/sound-initializer', () => ({ SoundInitializer: () => null }))

async function renderRootNotFound(): Promise<string> {
  const { default: NotFound } = await import('@/app/not-found')
  return renderToStaticMarkup(await NotFound())
}

describe('the root 404 is static and branded (AWTD-1599)', () => {
  beforeEach(() => {
    nextIntl.locale = 'de' // a request locale exists; the page must not read it
    connection.mockClear()
    vi.unstubAllEnvs()
  })

  it('stays prerendered on a hosted build (Vercel serves misses from the static /404)', async () => {
    vi.stubEnv('ASTRID_RUNTIME_BRAND', '')
    await renderRootNotFound()
    expect(connection).not.toHaveBeenCalled()
  })

  it('renders per request in an image that takes its brand at runtime (Copilot on #739)', async () => {
    vi.stubEnv('ASTRID_RUNTIME_BRAND', 'true')
    await renderRootNotFound()
    expect(connection).toHaveBeenCalledTimes(1)
  })

  it('renders the default locale without reading the request', async () => {
    const html = await renderRootNotFound()

    expect(html).toContain('<html lang="en"')
    expect(html).toContain(en.errorPages.notFoundTitle)
    expect(html).toContain(en.errorPages.notFoundGoHome)
  })
})

describe('the localized 404 handler (AWTD-1599)', () => {
  async function get(locale: string) {
    const { GET } = await import('@/app/missing/[locale]/route')
    const res = await GET(new Request(`https://example.test/missing/${locale}`), {
      params: Promise.resolve({ locale }),
    })
    return { res, html: await res.text() }
  }

  it('answers a miss under /de with a German 404', async () => {
    const { res, html } = await get('de')

    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toMatch(/^text\/html/)
    expect(html).toMatch(/^<!DOCTYPE html><html lang="de">/)
    expect(html).toContain(`<title>${de.errorPages.notFoundTitle} | Astrid</title>`)
    expect(html).toContain(de.errorPages.notFoundDescription)
    expect(html).toContain(`href="/de"`)
    expect(html).not.toContain(en.errorPages.notFoundTitle)
  })

  it('carries no script: nothing to hydrate, nothing to call', async () => {
    const { html } = await get('de')
    expect(html).not.toMatch(/<script/i)
    expect(html.length).toBeLessThan(4000)
  })

  it('answers in the default locale for a first segment that is not one', async () => {
    const { res, html } = await get('zz')

    expect(res.status).toBe(404)
    expect(html).toContain('<html lang="en">')
    expect(html).toContain(en.errorPages.notFoundTitle)
    expect(html).toContain(`href="/"`)
  })
})

describe('the locale layout 404s a first segment that is not a locale (AWTD-1599)', () => {
  beforeEach(() => {
    notFound.mockClear()
    vi.mocked(getMessages).mockClear()
  })

  async function renderLayout(locale: string) {
    const { default: LocaleLayout } = await import('@/app/[locale]/layout')
    return LocaleLayout({ children: null, params: Promise.resolve({ locale }) })
  }

  it.each(['nope.png', 'apple-touch-icon-precomposed.png', 'nope.md', 'icons'])(
    'calls notFound() for "%s" before loading any messages',
    async (segment) => {
      await expect(renderLayout(segment)).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
      expect(notFound).toHaveBeenCalledTimes(1)
      expect(getMessages).not.toHaveBeenCalled()
    },
  )

  it.each(['en', 'de', 'zh-TW'])('renders the app for the locale "%s"', async (locale) => {
    const tree = (await renderLayout(locale)) as React.ReactElement<{ lang: string }>
    expect(notFound).not.toHaveBeenCalled()
    expect(tree.props.lang).toBe(locale)
  })
})
