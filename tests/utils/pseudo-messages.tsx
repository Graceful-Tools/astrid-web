/**
 * A message set that is visibly not English, for asserting that a screen has no
 * hardcoded copy left (AWTD-1575).
 *
 * Every string in en.json is wrapped in ⟦ ⟧. A component rendered against it
 * shows only bracketed text and data; any letters outside the brackets were
 * typed into the component, and a German reader would see them in English.
 *
 * The regex metric that guided the first pass (scripts/report-design-metrics.ts)
 * only sees sentences in JSX text. It cannot see a single word, a string in a
 * ternary, a prop or a toast — which is exactly what was left behind — so this
 * checks what is rendered instead.
 */
import React from 'react'
import { NextIntlClientProvider } from 'next-intl'
import rawEnMessages from '@/lib/i18n/locales/en.json'
import { applyBrandToMessages } from '@/lib/brand/i18n-values'

const OPEN = '⟦'
const CLOSE = '⟧'

function wrap<T>(node: T): T {
  if (typeof node === 'string') return `${OPEN}${node}${CLOSE}` as unknown as T
  if (Array.isArray(node)) return node.map(wrap) as unknown as T
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, wrap(value)])) as T
  }
  return node
}

export const pseudoMessages = wrap(applyBrandToMessages(rawEnMessages))

export function PseudoLocale({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={pseudoMessages} onError={() => {}}>
      {children}
    </NextIntlClientProvider>
  )
}

/** Drop every ⟦…⟧ span, innermost first: a translated value can sit inside a translated sentence. */
function withoutTranslated(text: string): string {
  const innermost = new RegExp(`${OPEN}[^${OPEN}${CLOSE}]*${CLOSE}`, 'g')
  let previous: string
  do {
    previous = text
    text = text.replace(innermost, ' ')
  } while (text !== previous)
  return text
}

const SPOKEN_ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt']

/**
 * What a reader of another language would still get in English: visible text and
 * the attributes a screen reader speaks, minus translated spans and minus `data`
 * (names a person typed — a list name, a task title). An element holding a
 * single character is an avatar's initial, which is data too.
 */
export function hardcodedCopy(container: HTMLElement, data: string[] = []): string[] {
  const copy = container.cloneNode(true) as HTMLElement
  copy.querySelectorAll('*').forEach((element) => {
    if (element.childElementCount === 0 && (element.textContent ?? '').trim().length === 1) element.remove()
  })
  const sources = [copy.textContent ?? '']
  for (const attribute of SPOKEN_ATTRIBUTES) {
    copy.querySelectorAll(`[${attribute}]`).forEach((element) => sources.push(element.getAttribute(attribute) ?? ''))
  }
  // Longest first, so "Ada Lovelace" is removed before "Ada".
  const known = [...data].sort((a, b) => b.length - a.length)
  return sources
    .map((source) => known.reduce((text, value) => text.split(value).join(' '), withoutTranslated(source)))
    .flatMap((text) => text.match(/[A-Za-z][A-Za-z'’&\- ]*[A-Za-z]|[A-Za-z]/g) ?? [])
    .map((leftover) => leftover.trim())
    .filter(Boolean)
}
