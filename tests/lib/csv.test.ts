/**
 * lib/csv.ts — the one CSV writer (AWTD-1670). It was a private helper in the
 * user data export; the runtime-binding audit export needed the same thing, so
 * it moved here rather than being written twice.
 */
import { describe, it, expect } from 'vitest'
import { escapeCsvValue, toCsv } from '@/lib/csv'

describe('escapeCsvValue (AWTD-1670)', () => {
  it('AWTD-1670: leaves a plain value alone and writes null/undefined as empty', () => {
    expect(escapeCsvValue('plain')).toBe('plain')
    expect(escapeCsvValue(42)).toBe('42')
    expect(escapeCsvValue(null)).toBe('')
    expect(escapeCsvValue(undefined)).toBe('')
  })

  it('AWTD-1670: quotes commas, quotes, newlines and carriage returns, doubling inner quotes', () => {
    expect(escapeCsvValue('a,b')).toBe('"a,b"')
    expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"')
    expect(escapeCsvValue('line1\r\nline2')).toBe('"line1\r\nline2"')
  })

  it('AWTD-1670: neutralises spreadsheet formulas only when asked', () => {
    expect(escapeCsvValue('=HYPERLINK("http://x")')).toBe('"=HYPERLINK(""http://x"")"')
    expect(escapeCsvValue('=HYPERLINK("http://x")', { neutralizeFormulas: true })).toBe(`"'=HYPERLINK(""http://x"")"`)
    for (const lead of ['=', '+', '-', '@', '\t']) {
      expect(escapeCsvValue(`${lead}1+1`, { neutralizeFormulas: true }).replace(/^"/, '')).toMatch(/^'/)
    }
    // A number is data, not a formula, even when negative.
    expect(escapeCsvValue(-5, { neutralizeFormulas: true })).toBe('-5')
  })

  it('AWTD-1670: writes a Date as ISO 8601', () => {
    expect(escapeCsvValue(new Date('2026-11-14T00:00:00.000Z'))).toBe('2026-11-14T00:00:00.000Z')
  })
})

describe('toCsv (AWTD-1670)', () => {
  it('AWTD-1670: writes a header row and one row per record, in header order', () => {
    expect(toCsv(['b', 'a'], [{ a: 1, b: 'x,y' }, { a: 2 }])).toBe('b,a\n"x,y",1\n,2')
  })
})
