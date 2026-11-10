/**
 * RATCHET — the design system's no-regression gate (docs/specs/DESIGN_SYSTEM.md).
 *
 * Colours, sizes, durations and copy each have a shared home: the design
 * tokens, the theme classes, the locale files. `scripts/report-design-metrics.ts`
 * counts the places where one was typed out instead, and this fails when any
 * count rises above `design-metrics.budget.json`.
 *
 * It exists because the agents that work this board are fast and many. Each
 * `text-gray-400` is harmless; the web had 1,631 of them, three colours for
 * medium priority and 612 distinct sentences typed into JSX, and no number
 * anywhere said so.
 *
 * When this fails: use the token, theme class or i18n key the message names.
 * Do not raise a budget to get a change through. When a count falls, lower its
 * budget in the same pull request (`npm run design:metrics -- --update`), or
 * the next change quietly spends the gain.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { BUDGET_FILE, METRICS, count, measure, overBudget, withoutComments } from '@/scripts/report-design-metrics'

const metric = (id: string) => METRICS.find((entry) => entry.id === id)!
const source = (text: string, path = 'components/example.tsx') => [{ path, source: text }]

describe('what the design metrics count', () => {
  it('a palette class, wherever it is used', () => {
    expect(count(metric('rawPaletteClasses'), source('<p className="text-gray-400 hover:bg-blue-500/20 theme-text-muted" />'))).toBe(2)
  })

  it('not a comment about one', () => {
    const text = '// was text-gray-400\n/* bg-red-500 */\n{/* text-blue-500 */}\n<a href="https://x.test/#aabbcc" />'
    expect(withoutComments(text)).toContain('https://x.test')
    expect(count(metric('rawPaletteClasses'), source(text))).toBe(0)
  })

  it('a colour written out, but not in the modules that are its home', () => {
    expect(count(metric('hexColours'), source("const c = '#3b82f6'"))).toBe(1)
    expect(count(metric('hexColours'), source("const c = '#3b82f6'", 'lib/brand/colors.ts'))).toBe(0)
    expect(count(metric('rgbColours'), source('color: rgb(var(--astrid-accent)); border: 1px solid rgba(0, 0, 0, 0.1)'))).toBe(1)
  })

  it('an inline style, an arbitrary size and a typed duration', () => {
    expect(count(metric('inlineStyles'), source('<div style={{ width }} />'))).toBe(1)
    expect(count(metric('arbitrarySizes'), source('<div className="w-[37px] text-[10px] grid-cols-[1fr_auto]" />'))).toBe(2)
    expect(count(metric('motionLiterals'), source('.a { transition: transform 0.15s ease; animation: x 300ms; }\n<i className="duration-200" />', 'styles/a.css'))).toBe(3)
  })

  it('a sentence typed into JSX, once per distinct sentence for the unique count', () => {
    const text = '<p>Access Denied</p><p>Access Denied</p><input placeholder="Search tasks" /><p>{t("ok")}</p>'
    expect(count(metric('hardcodedCopy'), source(text))).toBe(3)
    expect(count(metric('uniqueHardcodedStrings'), source(text))).toBe(2)
  })
})

describe('the budgets', () => {
  it('a count above its budget is named, with what to use instead', () => {
    const problems = overBudget({ ...Object.fromEntries(METRICS.map((m) => [m.id, 0])), inlineStyles: 3 }, Object.fromEntries(METRICS.map((m) => [m.id, 1])))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('inlineStyles: 3 > 1')
    expect(problems[0]).toContain('Use a class')
  })

  it('every metric has one', () => {
    const budget = JSON.parse(readFileSync(join(process.cwd(), BUDGET_FILE), 'utf8'))
    expect(Object.keys(budget).sort()).toEqual(METRICS.map((m) => m.id).sort())
  })

  it('no count in this repository has risen above its budget', () => {
    const budget = JSON.parse(readFileSync(join(process.cwd(), BUDGET_FILE), 'utf8'))
    expect(overBudget(measure(process.cwd()), budget)).toEqual([])
  })
})
