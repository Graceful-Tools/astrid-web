/**
 * The "Task titles" appearance setting (docs/specs/DESIGN_SYSTEM.md → States).
 * Jon, 2026-11-10: a row title wraps by default, as on iOS, and a setting
 * chooses wrap, two lines or one.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ROW_TITLE_LINES,
  ROW_TITLE_CLASSES,
  ROW_TITLE_LINES,
  parseRowTitleLines,
  rowTitleClass,
} from '@/lib/design/row-title'

describe('row title lines', () => {
  it('wraps by default, as on iOS', () => {
    expect(DEFAULT_ROW_TITLE_LINES).toBe('wrap')
    expect(parseRowTitleLines(null)).toBe('wrap')
  })

  it('reads the three choices and nothing else', () => {
    expect(ROW_TITLE_LINES).toEqual(['wrap', '2', '1'])
    expect(parseRowTitleLines('2')).toBe('2')
    expect(parseRowTitleLines('1')).toBe('1')
    // A value from a newer build must not leave titles in a state nobody chose.
    expect(parseRowTitleLines('3')).toBe('wrap')
  })

  it('becomes one class on the document', () => {
    expect(rowTitleClass('2')).toBe('row-title-2')
    expect(ROW_TITLE_CLASSES).toEqual(['row-title-wrap', 'row-title-2', 'row-title-1'])
  })

  it('the stylesheet clamps a row title under the two limited classes only', () => {
    const css = readFileSync(join(process.cwd(), 'styles', 'components.css'), 'utf8')
    expect(css).toMatch(/\.row-title-2 \.task-title \{ -webkit-line-clamp: 2;/)
    expect(css).toMatch(/\.row-title-1 \.task-title \{ -webkit-line-clamp: 1;/)
    expect(css).not.toContain('.row-title-wrap .task-title')
  })

  it('every locale names the setting and its three choices', () => {
    for (const locale of ['en', 'de', 'ja']) {
      const page = JSON.parse(readFileSync(join(process.cwd(), 'lib', 'i18n', 'locales', `${locale}.json`), 'utf8'))
        .settingsPages.appearancePage.taskTitles
      for (const lines of ROW_TITLE_LINES) {
        expect(page[`option${lines}`], `${locale} option${lines}`).toBeTruthy()
        expect(page[`desc${lines}`], `${locale} desc${lines}`).toBeTruthy()
      }
    }
  })
})
