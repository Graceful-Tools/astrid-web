/**
 * AWTD-1575: /download was translated except for what the browser tab and a
 * shared link show — `metadata` was a static export, built before any request
 * and therefore before any locale.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { applyBrandToMessages } from '@/lib/brand/i18n-values'
import { BRAND } from '@/lib/brand/config'

const LOCALES_DIR = join(process.cwd(), 'lib/i18n/locales')
const LOCALES = readdirSync(LOCALES_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => basename(file, '.json'))

type DownloadMessages = { metaTitle: string; metaDescription: string }

function downloadMessages(locale: string): DownloadMessages {
  return applyBrandToMessages(JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), 'utf8'))).downloadPage
}

const requestLocale = vi.hoisted(() => ({ current: 'en' }))
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => {
    if (namespace !== 'downloadPage') throw new Error(`unexpected namespace ${namespace}`)
    const messages = downloadMessages(requestLocale.current) as Record<string, string>
    return (key: string) => messages[key] ?? key
  },
}))

const page = await import('@/app/[locale]/download/page')

/** What the locale layout resolved: the page must keep these and change only the words. */
const parent = Promise.resolve({
  openGraph: { title: 'Brand', description: 'Brand default', siteName: 'kept' },
  twitter: { title: 'Brand', description: 'Brand default', card: 'summary' },
}) as unknown as Parameters<typeof page.generateMetadata>[1]

describe('/download describes itself in the request locale (AWTD-1575)', () => {
  it('has no static metadata export left to win over generateMetadata', () => {
    expect('metadata' in page).toBe(false)
    expect(typeof page.generateMetadata).toBe('function')
  })

  it.each(LOCALES)('%s', async (locale) => {
    requestLocale.current = locale
    const metadata = await page.generateMetadata({}, parent)
    const expected = downloadMessages(locale)

    expect(metadata).toMatchObject({ title: expected.metaTitle, description: expected.metaDescription })
    // A shared link shows openGraph/twitter, which the locale layout sets to the
    // brand defaults; overriding only the top level left the preview in English.
    expect(metadata.openGraph).toMatchObject({ title: expected.metaTitle, description: expected.metaDescription, siteName: 'kept' })
    expect(metadata.twitter).toMatchObject({ title: expected.metaTitle, description: expected.metaDescription, card: 'summary' })
    expect(String(metadata.title)).toContain(BRAND.appName)
    expect(String(metadata.title)).not.toContain('{')
  })

  it('keeps the English wording it had as a static export', async () => {
    requestLocale.current = 'en'
    expect(await page.generateMetadata({}, parent)).toMatchObject({
      title: `Download ${BRAND.appName} for Mac`,
      description: `${BRAND.appName} for Mac — a native desktop app for your tasks, lists, and chat.`,
    })
  })

  it.each(LOCALES.filter((locale) => locale !== 'en'))('%s is translated, not English repeated', (locale) => {
    expect(downloadMessages(locale).metaDescription).not.toBe(downloadMessages('en').metaDescription)
  })
})
