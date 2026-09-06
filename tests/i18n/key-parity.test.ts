/**
 * RED for task d818849d — every key in en.json must exist in all eleven other
 * locales, and no locale may carry a key en does not.
 *
 * The Custom Agents settings feature shipped with 42 keys that landed in en
 * only. The missing set was IDENTICAL across all eleven locales, which is the
 * signature of a whole feature falling out of translation at once — and
 * nothing caught it, because nothing was looking.
 *
 * The reverse direction matters too: a key a locale still has but en has
 * dropped is dead weight that reads as translated coverage.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'

const LOCALES_DIR = join(process.cwd(), 'lib/i18n/locales')

type Messages = { [key: string]: string | Messages }

function flatten(obj: Messages, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'object' && value !== null ? flatten(value, path) : [path]
  })
}

function load(locale: string): Messages {
  return JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), 'utf8'))
}

const LOCALES = readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => basename(f, '.json'))

const OTHER_LOCALES = LOCALES.filter((l) => l !== 'en')
const EN_KEYS = new Set(flatten(load('en')))

describe('locale key parity (task d818849d)', () => {
  it('finds the locale files', () => {
    // A glob matching nothing would make everything below vacuously pass.
    expect(LOCALES).toContain('en')
    expect(OTHER_LOCALES.length).toBeGreaterThanOrEqual(11)
  })

  it.each(OTHER_LOCALES)('%s has every key en has', (locale) => {
    const keys = new Set(flatten(load(locale)))
    const missing = [...EN_KEYS].filter((k) => !keys.has(k)).sort()

    expect(missing, `${locale}.json is missing ${missing.length} keys`).toEqual([])
  })

  it.each(OTHER_LOCALES)('%s carries no key en has dropped', (locale) => {
    const stale = flatten(load(locale)).filter((k) => !EN_KEYS.has(k)).sort()

    expect(stale, `${locale}.json has ${stale.length} keys en does not`).toEqual([])
  })

  it.each(OTHER_LOCALES)('%s does not simply repeat the English string', (locale) => {
    // A key backfilled by copying en satisfies parity while translating
    // nothing, which is the failure this gate exists to prevent. Short and
    // proper-noun-ish values legitimately match, so this only flags a locale
    // where the OVERWHELMING majority of long strings are identical to en.
    const en = load('en')
    const target = load(locale)

    const read = (msgs: Messages, path: string): string | undefined => {
      const value = path.split('.').reduce<string | Messages | undefined>(
        (acc, part) => (typeof acc === 'object' && acc !== null ? acc[part] : undefined),
        msgs
      )
      return typeof value === 'string' ? value : undefined
    }

    const longKeys = [...EN_KEYS].filter((k) => (read(en, k)?.length ?? 0) > 25)
    const identical = longKeys.filter((k) => read(en, k) === read(target, k))

    expect(
      identical.length / Math.max(longKeys.length, 1),
      `${locale}.json repeats en verbatim for ${identical.length}/${longKeys.length} long strings`
    ).toBeLessThan(0.5)
  })
})
