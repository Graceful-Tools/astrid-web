/**
 * AWTD-1575: a mistyped address under /de rendered the root 404 — hardcoded
 * English under <html lang="en"> — because app/[locale]/not-found.tsx is only
 * reached when something inside [locale] calls notFound(), and an address no
 * route matches never gets inside. next-intl's answer is a catch-all page that
 * does exactly that.
 */
import { describe, it, expect, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;404')
  }),
)
vi.mock('next/navigation', () => ({ notFound }))

const ROOT = process.cwd()

describe('an unknown address under a locale gets the localized 404 (AWTD-1575)', () => {
  it('has a catch-all page under [locale] that only calls notFound()', async () => {
    expect(existsSync(join(ROOT, 'app/[locale]/[...rest]/page.tsx'))).toBe(true)
    const { default: UnknownLocalizedPage } = await import('@/app/[locale]/[...rest]/page')

    expect(() => UnknownLocalizedPage()).toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
    expect(notFound).toHaveBeenCalledTimes(1)
  })

  it('keeps the localized page itself free of a hardcoded language', () => {
    const page = readFileSync(join(ROOT, 'app/[locale]/not-found.tsx'), 'utf8')
    expect(page).toContain("getTranslations('errorPages')")
    expect(page).not.toMatch(/<html/)
  })

  it('sends a path whose first segment is not a locale to the root 404, before any message is loaded', () => {
    // With the catch-all in place, /icons/missing.png (which the middleware
    // skips) would otherwise render the app shell under <html lang="icons">.
    const layout = readFileSync(join(ROOT, 'app/[locale]/layout.tsx'), 'utf8')
    const guard = layout.indexOf('if (!hasLocale(routing.locales, locale)) notFound()')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(layout.indexOf('setRequestLocale(locale)'))
    expect(guard).toBeLessThan(layout.indexOf('await getMessages()'))
  })
})
