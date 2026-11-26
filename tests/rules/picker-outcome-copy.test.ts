import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Task ab01186a — name the outcome, not the mechanic.
 *
 * The pickers used to label the ESCAPE from a value by what happens to the
 * field rather than by the state the user is choosing:
 *
 *   Date:   "Clear" -> "No date"
 *   Time:   "Clear" -> "All day"        (a task with no time is not a task
 *                                        with a missing field — it is an
 *                                        all-day task, a real nameable state)
 *   Repeat: "Never" -> "One time only"  ("how often?" answered with a state,
 *                                        not a negative)
 *
 * Companion to the iOS/Mac change shipped 2026-08-02 (task 42013da7), whose
 * keys are `picker.no_due_date`, `picker.all_day` and
 * `repeating.one_time_only`. These are shared user-facing strings, so they
 * are i18n keys on both platforms rather than literals in a component.
 */

const LOCALES_DIR = path.join(process.cwd(), 'lib/i18n/locales')
const LOCALES = fs.readdirSync(LOCALES_DIR).filter(f => f.endsWith('.json'))

/**
 * Components whose picker copy this contract governs.
 *
 * Deliberately NOT included: `components/custom-repeating-editor.tsx`. Its
 * "Never" answers a different question — "when does this repeat END?" — and
 * there "never" IS the outcome (it never ends), not a negative standing in for
 * one. The bug was answering "how often?" with a negation.
 */
const PICKER_SOURCES = [
  'components/task-detail/TaskFieldEditors.tsx',
  'components/ui/time-picker.tsx',
  'components/list-admin/DefaultTaskSettingsSection.tsx',
]

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8')
}

describe('picker outcome copy (task ab01186a)', () => {
  describe('the three states are named, in every locale', () => {
    it.each(LOCALES)('%s has time.noDate, time.allDay and repeating.oneTimeOnly', (locale) => {
      const messages = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale), 'utf8'))

      expect(messages.time?.noDate, `${locale} time.noDate`).toBeTruthy()
      expect(messages.time?.allDay, `${locale} time.allDay`).toBeTruthy()
      expect(messages.repeating?.oneTimeOnly, `${locale} repeating.oneTimeOnly`).toBeTruthy()
    })

    it('names the outcome in English, not the mechanic', () => {
      const en = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, 'en.json'), 'utf8'))

      expect(en.time.noDate).toBe('No date')
      expect(en.time.allDay).toBe('All day')
      expect(en.repeating.oneTimeOnly).toBe('One time only')
    })
  })

  describe('the pickers use those keys instead of literals', () => {
    it.each(PICKER_SOURCES)('%s has no bare "Clear" or "Never" label', (file) => {
      const source = read(file)

      // A label is JSX text or a string prop — not a handler name like
      // handleClear, and not a `value="never"` (the stored value is
      // unchanged; only what the user reads changes).
      expect(source, `${file} renders a bare "Clear" label`).not.toMatch(/>\s*Clear(\s+Date)?\s*</)
      expect(source, `${file} renders a bare "Never" label`).not.toMatch(/>\s*Never\s*</)
      expect(source, `${file} has a hardcoded "Never" label prop`).not.toMatch(/label:\s*["']Never["']/)
      expect(source, `${file} renders a bare "All Day" label`).not.toMatch(/>\s*All Day\s*</)
    })

    it('keeps the stored repeat value "never" — this is a copy change, not a data change', () => {
      const source = read('components/task-detail/TaskFieldEditors.tsx')
      expect(source).toMatch(/value="never"/)
    })
  })
})
