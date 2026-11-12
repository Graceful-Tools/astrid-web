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
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type React from 'react'
import { getMessages } from 'next-intl/server'
import de from '@/lib/i18n/locales/de.json'
import en from '@/lib/i18n/locales/en.json'

const MESSAGES = { de, en } as const
const nextIntl = vi.hoisted(() => ({ locale: 'en' as 'de' | 'en' }))

vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => nextIntl.locale),
  getTranslations: vi.fn(async (namespace: string) => {
    const table = (MESSAGES[nextIntl.locale] as unknown as Record<string, Record<string, string>>)[namespace]
    return (key: string) => table[key]
  }),
  getMessages: vi.fn(async () => ({})),
  setRequestLocale: vi.fn(),
}))

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

describe('the root 404 speaks the request language (AWTD-1599)', () => {
  beforeEach(() => {
    nextIntl.locale = 'en'
  })

  it('renders German under lang="de" for a miss under /de', async () => {
    nextIntl.locale = 'de'
    const html = await renderRootNotFound()

    expect(html).toContain('<html lang="de"')
    expect(html).toContain(de.errorPages.notFoundTitle)
    expect(html).toContain(de.errorPages.notFoundDescription)
    expect(html).toContain(de.errorPages.notFoundGoHome)
    expect(html).not.toContain(en.errorPages.notFoundTitle)
  })

  it('renders English under lang="en" when the request has no locale', async () => {
    const html = await renderRootNotFound()

    expect(html).toContain('<html lang="en"')
    expect(html).toContain(en.errorPages.notFoundTitle)
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
