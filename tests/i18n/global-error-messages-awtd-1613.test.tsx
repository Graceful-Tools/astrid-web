/**
 * AWTD-1613 — the crash page (app/global-error.tsx) said "Something went wrong" in English to
 * everyone. It renders without the translation providers, so it reads a static lookup keyed by
 * the locale in the address; these keep that lookup equal to the locale files and prove the
 * page uses it.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { locales } from '@/lib/i18n/config'
import { GLOBAL_ERROR_MESSAGES, globalErrorLocale } from '@/lib/i18n/global-error-messages'
import { GLOBAL_ERROR_ENGLISH } from '@/lib/i18n/global-error-english'

vi.mock('@/lib/log-boundary-error', () => ({ logBoundaryError: vi.fn() }))

const errorPages = (locale: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'lib/i18n/locales', `${locale}.json`), 'utf8')).errorPages

describe('the crash page speaks the reader’s language (AWTD-1613)', () => {
  it.each(locales)('%s: the lookup matches errorPages.* in the locale file', (locale) => {
    const source = errorPages(locale)
    expect(GLOBAL_ERROR_MESSAGES[locale]).toEqual({
      title: source.globalErrorTitle,
      description: source.globalErrorDescription,
      tryAgain: source.tryAgain,
      goHome: source.goHome,
    })
  })

  it('the English that ships with the page is the English in the table', () => {
    expect(GLOBAL_ERROR_MESSAGES.en).toBe(GLOBAL_ERROR_ENGLISH)
  })

  it('takes the locale from the first segment of the address', () => {
    expect(globalErrorLocale('/de/lists/abc')).toBe('de')
    expect(globalErrorLocale('/zh-tw')).toBe('zh-TW')
    expect(globalErrorLocale('/zh-CN/settings')).toBe('zh-CN')
    // localePrefix 'as-needed': no segment means the default locale.
    expect(globalErrorLocale('/lists/abc')).toBe('en')
    expect(globalErrorLocale('/')).toBe('en')
    expect(globalErrorLocale(null)).toBe('en')
  })

  describe('the page', () => {
    afterEach(() => window.history.replaceState(null, '', '/'))

    it('renders the German words on a German address', async () => {
      window.history.replaceState(null, '', '/de/lists/abc')
      const { default: GlobalError } = await import('@/app/global-error')
      // It renders its own <html>; jsdom accepts that inside a container with a warning.
      vi.spyOn(console, 'error').mockImplementation(() => {})
      render(<GlobalError error={new Error('boom')} reset={() => {}} />)
      // English first: the page is in every first load, so the other languages load on render.
      expect(await screen.findByText(GLOBAL_ERROR_MESSAGES.de.title)).toBeInTheDocument()
      expect(screen.getByText(GLOBAL_ERROR_MESSAGES.de.description)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: GLOBAL_ERROR_MESSAGES.de.tryAgain })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: GLOBAL_ERROR_MESSAGES.de.goHome })).toBeInTheDocument()
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
    })
  })
})
