/**
 * Task-detail field labels go through `t()` (task bf57678e).
 *
 * TaskFieldEditors already imports useTranslations and uses it correctly for the
 * values — t('time.noDate'), t('time.allDay'), t('repeating.*') — while the
 * labels sitting directly beside those translated values were English literals.
 * So a non-English user saw "Priority" in English above a due date rendered in
 * their own language, in the most-opened pane in the product across all 12
 * shipped locales.
 *
 * `npm run check:reuse` does not catch this: its hardcoded-copy rule covers
 * add-task placeholders and brand literals only, which is how six of them got
 * in. That is the reason for a test rather than a lint pass.
 *
 * Asserted at the source rather than by rendering: TaskFieldEditors takes
 * twenty-odd props plus pickers, and the property under test — "does this label
 * come from a translation call" — is a fact about the JSX, not about runtime.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const src = readFileSync(
  join(process.cwd(), 'components/task-detail/TaskFieldEditors.tsx'),
  'utf8',
)

const LOCALES_DIR = join(process.cwd(), 'lib/i18n/locales')
const localeFiles = readdirSync(LOCALES_DIR).filter(f => f.endsWith('.json'))

/** The six labels named in the task. */
const HARDCODED_LABELS = ['When', 'Created by', 'Priority', 'Assignee', 'Lists', 'Description']

function lookup(json: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as never)[part] : undefined),
    json,
  )
}

describe('task-detail field labels are translated (task bf57678e)', () => {
  for (const label of HARDCODED_LABELS) {
    it(`does not pass "${label}" to TaskFieldRow as an English literal`, () => {
      expect(src).not.toContain(`label="${label}"`)
    })
  }

  it('routes every TaskFieldRow label through t()', () => {
    // Catches a seventh label added later without a translation.
    const labels = [...src.matchAll(/<TaskFieldRow[\s\S]{0,80}?label=\{?([^\s>]+)/g)].map(m => m[1])
    expect(labels.length, 'no TaskFieldRow labels found — did the markup change?').toBeGreaterThan(3)
    for (const label of labels) {
      expect(label, `TaskFieldRow label ${label} is not a t() call`).toContain('t(')
    }
  })
})

describe('the keys those labels use exist in every shipped locale', () => {
  // A t() call for a missing key renders the key itself, so the panel would
  // read "tasks.when" — worse than the English it replaced.
  const REQUIRED_KEYS = [
    'tasks.when',
    'tasks.createdBy',
    'tasks.priority',
    'tasks.assignee',
    'tasks.taskDescription',
    'navigation.lists',
  ]

  for (const file of localeFiles) {
    it(`${file} defines all six`, () => {
      const json = JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8'))
      for (const key of REQUIRED_KEYS) {
        const value = lookup(json, key)
        expect(typeof value, `${file} is missing ${key}`).toBe('string')
        expect((value as string).length, `${file} has an empty ${key}`).toBeGreaterThan(0)
      }
    })
  }

  it('ships the twelve locales the product claims', () => {
    expect(localeFiles.length).toBe(12)
  })

  it('actually translated the two new keys rather than copying English', () => {
    // A locale file full of English strings passes "the key exists" while
    // leaving the panel exactly as broken as before.
    const nonEnglish = localeFiles.filter(f => f !== 'en.json')
    const untranslated = nonEnglish.filter(file => {
      const json = JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8'))
      return lookup(json, 'tasks.when') === 'When' && lookup(json, 'tasks.createdBy') === 'Created by'
    })
    expect(untranslated, `these locales still hold the English strings`).toEqual([])
  })
})
