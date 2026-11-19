/**
 * The Done card's completed-date pill text (Jon, 2026-11-19 follow-up): the same
 * words on every client, with a plain U+2713 check — never U+2714 or an emoji,
 * which can render as a coloured glyph — and `{date}` for the short date.
 * iOS carries the same values under `board.card.completed_pill`.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const EXPECTED: Record<string, string> = {
  en: '✓ on {date}',
  de: '✓ am {date}',
  es: '✓ el {date}',
  fr: '✓ le {date}',
  it: '✓ il {date}',
  nl: '✓ op {date}',
  pt: '✓ em {date}',
  ru: '✓ {date}',
  ja: '✓ {date}',
  ko: '✓ {date}',
  'zh-CN': '✓ {date}',
  'zh-TW': '✓ {date}',
}

describe('tasks.board.completedPill', () => {
  for (const [locale, value] of Object.entries(EXPECTED)) {
    it(`${locale} is exactly "${value}"`, () => {
      const messages = JSON.parse(readFileSync(join(process.cwd(), 'lib/i18n/locales', `${locale}.json`), 'utf8'))
      expect(messages.tasks.board.completedPill).toBe(value)
      expect(messages.tasks.board.completedPill).not.toMatch(/[✔✅]/)
    })
  }
})
