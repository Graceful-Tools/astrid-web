import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { useTranslations } from '@/lib/i18n/client'

// AWTD-1575: a value typed by a person is text, not a String.replace pattern.
// "Cash $& carry" used to come out as "Cash {name} carry".
describe('t() inserts replacement values literally (AWTD-1575)', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <NextIntlClientProvider locale="en" messages={{ greet: 'List {name} deleted' }}>
      {children}
    </NextIntlClientProvider>
  )

  it.each(['Cash $& carry', "a$'b", 'x$`y', '$1 store', 'me+$&@example.test'])('keeps %s as typed', (name) => {
    const { result } = renderHook(() => useTranslations(), { wrapper })
    expect(result.current.t('greet', { name })).toBe(`List ${name} deleted`)
  })
})
