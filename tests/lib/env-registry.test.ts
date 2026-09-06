/**
 * Task 0c387855 — properties of the environment registry that the drift
 * script cannot check, because it compares the registry to other things rather
 * than checking the registry itself.
 */
import { describe, it, expect } from 'vitest'
import { ENV_VARS, ENV_BY_NAME, documentedVars, requiredVars } from '@/lib/env'

describe('environment registry (task 0c387855)', () => {
  it('has no duplicate entries', () => {
    const names = ENV_VARS.map((v) => v.name)
    const duplicates = names.filter((n, i) => names.indexOf(n) !== i)
    expect(duplicates).toEqual([])
    expect(ENV_BY_NAME.size).toBe(ENV_VARS.length)
  })

  it('gives every variable a description that says what breaks without it', () => {
    for (const v of ENV_VARS) {
      expect(v.description.length, `${v.name} has no description`).toBeGreaterThan(15)
    }
  })

  it('names every variable in SCREAMING_SNAKE_CASE', () => {
    for (const v of ENV_VARS) {
      // A leading underscore is allowed only for the runtime's own internals,
      // which the app reads but never sets (__NEXT_PRIVATE_ORIGIN).
      expect(v.name, `${v.name} is not an env var name`).toMatch(/^_{0,2}[A-Z][A-Z0-9_]*$/)
    }
  })

  it('keeps CRON_SECRET required', () => {
    // It was absent from the validator for months while lib/cron-auth.ts failed
    // closed on it, so all five cron routes 401'd silently (task a5eb65a4).
    expect(requiredVars().map((v) => v.name)).toContain('CRON_SECRET')
  })

  it('treats host-injected variables as neither required nor documented', () => {
    const documented = new Set(documentedVars().map((v) => v.name))
    for (const v of ENV_VARS.filter((e) => e.scope === 'platform')) {
      expect(documented.has(v.name), `${v.name} is host-injected`).toBe(false)
    }
  })

  it('accepts and rejects values with the validators it declares', () => {
    const url = ENV_BY_NAME.get('NEXTAUTH_URL')!
    expect(url.validate!('https://example.test')).toBeNull()
    expect(url.validate!('example.test')).toBeTruthy()

    const colour = ENV_BY_NAME.get('NEXT_PUBLIC_BRAND_ACCENT_COLOR')!
    expect(colour.validate!('#a855f7')).toBeNull()
    expect(colour.validate!('purple')).toBeTruthy()

    const db = ENV_BY_NAME.get('DATABASE_URL')!
    expect(db.validate!('postgresql://u:p@h/db')).toBeNull()
    expect(db.validate!('mysql://u:p@h/db')).toBeTruthy()
  })
})
