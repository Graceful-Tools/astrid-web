/**
 * AWTD-1613 — Help & Troubleshooting was the last product page typed into JSX in English.
 *
 * It now reads from the `helpPage` namespace of every locale, and the legal-page chrome around
 * it (the footer links) from `legalPages`. The English page must render exactly as it did
 * before; the move was checked by diffing the rendered HTML before and after, and these keep
 * the parts that could quietly regress.
 */
import React from 'react'
import { render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import { HelpContent } from '@/components/legal/HelpContent'
import { LegalPageShell } from '@/components/legal/LegalPageShell'
import { BRAND } from '@/lib/brand/config'
import { applyBrandToMessages } from '@/lib/brand/i18n-values'
import { locales } from '@/lib/i18n/config'
import { PseudoLocale, hardcodedCopy } from '@/tests/utils/pseudo-messages'

// Help reads the real messages through the app's hook, not the shared test stub.
vi.unmock('@/lib/i18n/client')

async function messagesFor(locale: string) {
  return applyBrandToMessages((await import(`@/lib/i18n/locales/${locale}.json`)).default)
}

function Help() {
  return (
    <LegalPageShell width="max-w-4xl" links={['terms', 'privacy']}>
      <HelpContent />
    </LegalPageShell>
  )
}

async function markup(locale: string) {
  const messages = await messagesFor(locale)
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <Help />
    </NextIntlClientProvider>,
  )
}

describe('Help in every language (AWTD-1613)', () => {
  it('English reads as it did, with the bold menu names and keyboard keys in place', async () => {
    const html = await markup('en')
    expect(html).toContain('Help &amp; Troubleshooting')
    expect(html).toContain(
      'Go to <strong>Settings</strong> (tap your profile in the sidebar) → <strong>Account</strong> → <strong>Sign Out</strong>. Then sign back in with the same account.',
    )
    expect(html).toContain('Press <kbd class="px-2 py-0.5 theme-bg-tertiary rounded text-xs">F5</kbd> or')
    expect(html).toContain('&quot;Cached images&quot;<br/><strong>Safari:</strong>')
    expect(html).toContain(`Search for &quot;${BRAND.domain}&quot;`)
    expect(html).toContain(`Right-click ${BRAND.wordmark} entries`)
    expect(html).toContain('Clear Browser Cache and Cookies for ' + BRAND.appName)
    expect(html).toContain('>Terms of Service</a>')
    expect(html).toContain('>Back to Home</a>')
  })

  it.each(locales)('%s renders every message, with the same formatting as English', async (locale) => {
    const english = await markup('en')
    const html = await markup(locale)
    const count = (text: string, tag: string) => text.split(`<${tag}`).length - 1
    for (const tag of ['strong', 'kbd', 'br', 'li', 'h3']) {
      expect(count(html, tag), `<${tag}> in ${locale}`).toBe(count(english, tag))
    }
    expect(html).not.toMatch(/\{(appName|brandDomain|wordmark)\}/)
    // A missing key renders as the key itself; a broken tag as literal angle brackets.
    expect(html).not.toContain('helpPage.')
    expect(html).not.toMatch(/&lt;\/?(b|kbd)&gt;/)
    if (locale !== 'en') expect(html).not.toContain('Help &amp; Troubleshooting')
  })

  it('leaves no English typed into the page or its footer', () => {
    const { container } = render(
      <PseudoLocale>
        <Help />
      </PseudoLocale>,
    )
    // The Decision guide is shared with the developer docs, which stay in English (AWTD-1613).
    container.querySelector('[data-testid="decision-format-guide"]')?.remove()
    const data = [BRAND.appName, BRAND.wordmark, BRAND.operatorName, String(new Date().getFullYear())]
    expect(hardcodedCopy(container, data)).toEqual([])
  })
})
