/**
 * AWTD-1607 — "German: du or Sie". The German locale had drifted into two
 * registers (older strings said "Sie", newer ones "du"). The app addresses
 * people as "du"; this test keeps formal address out of de.json.
 *
 * Matching is case-sensitive on purpose: lowercase "sie" means "she/they" and
 * is fine. Capitalised "Sie"/"Ihr…" at the very start of a sentence can also
 * mean "They"/"Their"; if a string genuinely needs that, add its key to
 * ALLOWED_THIRD_PERSON with a note instead of weakening the pattern.
 */
import { describe, expect, it } from 'vitest'
import de from '@/lib/i18n/locales/de.json'

const FORMAL_ADDRESS = /\b(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)\b/

const ALLOWED_THIRD_PERSON = new Set<string>([])

function flatten(value: unknown, prefix = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[prefix, value]]
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
  }
  return []
}

describe('AWTD-1607: German uses informal "du" everywhere', () => {
  it('de.json contains no formal address (Sie / Ihr / Ihre / Ihnen)', () => {
    const offenders = flatten(de)
      .filter(([key, text]) => !ALLOWED_THIRD_PERSON.has(key) && FORMAL_ADDRESS.test(text))
      .map(([key, text]) => `${key}: ${text}`)
    expect(offenders).toEqual([])
  })

  it('the pattern ignores lowercase "sie" (they)', () => {
    expect(FORMAL_ADDRESS.test('wenn sie gelöscht wurden')).toBe(false)
    expect(FORMAL_ADDRESS.test('Bist du sicher?')).toBe(false)
    expect(FORMAL_ADDRESS.test('Sind Sie sicher?')).toBe(true)
  })
})
