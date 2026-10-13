/**
 * RED for AWTD-1241 — the won't-do strings shipped in English everywhere.
 *
 * `tasks.wontDo`, `tasks.reopen` and `tasks.wontDoChip` were added with the
 * won't-do close reason and left as "Won't do" / "Reopen" in all eleven
 * non-English locales. A French user closing a task read an English menu item.
 *
 * Key parity did not catch it and never would have: every key was present in
 * every file, with the English string in it. `tests/i18n/translations.test.ts`
 * asks whether the keys line up, which is a different question from whether
 * anybody translated them.
 *
 * astrid-ios carries real translations for the mapped keys (`tasks.wont_do`,
 * `tasks.reopen`, `tasks.wont_do_chip`) in the same eleven languages, so these
 * are those words rather than a second set — docs/PRODUCT_CONTRACT.md §2 is
 * where the two platforms' key names are registered.
 *
 * Narrow on purpose. A general "no locale value equals its English value" rule
 * would be wrong: plenty of strings genuinely are the same word in several
 * languages ("Status"), and a few are proper nouns everywhere. These three are
 * known to differ in all eleven, because iOS's translators translated them.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const LOCALES_DIR = join(process.cwd(), 'lib/i18n/locales')

/** The three strings this task is about, by their web key under `tasks`. */
const KEYS = ['wontDo', 'reopen', 'wontDoChip'] as const

function tasksSection(locale: string): Record<string, unknown> {
  const raw = readFileSync(join(LOCALES_DIR, `${locale}.json`), 'utf8')
  return (JSON.parse(raw) as { tasks: Record<string, unknown> }).tasks
}

const english = tasksSection('en')

const otherLocales = readdirSync(LOCALES_DIR)
  .filter(file => file.endsWith('.json'))
  .map(file => file.replace(/\.json$/, ''))
  .filter(locale => locale !== 'en')
  .sort()

describe("the won't-do strings are translated (AWTD-1241)", () => {
  it('covers every locale the app ships, not a hand-written list', () => {
    // If a locale is added, it is held to this too — the point of reading the
    // directory rather than naming eleven files.
    expect(otherLocales.length).toBeGreaterThanOrEqual(11)
  })

  for (const key of KEYS) {
    it(`tasks.${key} is not the English string in any other locale`, () => {
      const untranslated = otherLocales.filter(
        locale => tasksSection(locale)[key] === english[key]
      )

      expect(
        untranslated,
        `tasks.${key} still reads "${String(english[key])}" in: ${untranslated.join(', ')}. ` +
          `astrid-ios has these words translated under the mapped key — copy them ` +
          `across rather than inventing a second wording (docs/PRODUCT_CONTRACT.md §2).`
      ).toEqual([])
    })
  }

  it('leaves the English base alone', () => {
    expect(english.wontDo).toBe("Won't do")
    expect(english.reopen).toBe('Reopen')
    // The chip says the same words as the menu item it reflects.
    expect(english.wontDoChip).toBe("Won't do")
  })
})
