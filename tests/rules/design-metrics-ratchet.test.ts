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
 * medium priority and 802 distinct sentences typed into JSX, and no number
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

import { BUDGET_FILE, METRICS, count, literalStyleProps, measure, overBudget, withoutComments } from '@/scripts/report-design-metrics'

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
    expect(count(metric('inlineStyles'), source("<div style={{ width: '33%' }} />"))).toBe(1)
    expect(count(metric('arbitrarySizes'), source('<div className="w-[37px] text-[10px] grid-cols-[1fr_auto]" />'))).toBe(2)
    expect(count(metric('motionLiterals'), source('.a { transition: transform 0.15s ease; animation: x 300ms; }\n<i className="duration-200" />', 'styles/a.css'))).toBe(3)
  })

  it('a sentence typed into JSX, once per distinct sentence for the unique count', () => {
    const text = '<p>Access Denied</p><p>Access Denied</p><input placeholder="Search tasks" /><p>{t("ok")}</p>'
    expect(count(metric('hardcodedCopy'), source(text))).toBe(3)
    expect(count(metric('uniqueHardcodedStrings'), source(text))).toBe(2)
  })

  // PR #700 review. Each of these let a regression through or failed a clean change.
  it('a sentence with punctuation is still a sentence', () => {
    expect(count(metric('hardcodedCopy'), source('<p>Select an OAuth app to edit.</p><p>Are you sure? This cannot be undone.</p>'))).toBe(2)
  })

  it('an expression is not a sentence', () => {
    expect(count(metric('hardcodedCopy'), source('const ok = a > Limit && b < c\n<p>{count} Tasks left</p>'))).toBe(0)
  })

  it('the same words in a text node, a placeholder and an aria-label are one string', () => {
    const text = '<p>Search tasks</p><input placeholder="Search tasks" aria-label="Search tasks" />'
    expect(count(metric('hardcodedCopy'), source(text))).toBe(3)
    expect(count(metric('uniqueHardcodedStrings'), source(text))).toBe(1)
  })

  // AWTD-1616: the count is the fixed values a class should carry, not every style prop.
  it('an inline style that only carries run-time values is not counted', () => {
    const computed = [
      '<i style={{ color: list.color }} />',
      '<i style={{ width }} />',
      '<i style={{ top: `${arrowTop}px` }} />',
      '<i style={{ backgroundColor: `${label.color}25`, color: label.color }} />',
      '<i style={{ height: isRefreshing ? 60 : Math.min(distance, 60) }} />',
      '<i style={{ ...(depth ? { marginLeft: depth * 24 } : {}) }} />',
    ]
    for (const text of computed) expect(count(metric('inlineStyles'), source(text)), text).toBe(0)
  })

  it('an inline style counts once if any of its values is fixed', () => {
    const fixed = [
      "<i style={{ zIndex: 9999 }} />",
      '<i style={{ position: "relative", zIndex: 10000 }} />',
      "<i style={{ left: x - 18, right: 10, width: 'auto' }} />",
      "<i style={{ backgroundColor: list.color, color: 'white' }} />",
      '<i style={{ maxHeight: `120px` }} />',
    ]
    for (const text of fixed) expect(count(metric('inlineStyles'), source(text)), text).toBe(1)
    expect(literalStyleProps("<i style={{ a: f({ b: 1 }), c: 'x, y' }} /><b style={{ d: e }} />")).toHaveLength(1)
  })

  it('global-error keeps its inline styles: app CSS may not have loaded there', () => {
    expect(count(metric('inlineStyles'), source("<div style={{ display: 'flex' }} />", 'app/global-error.tsx'))).toBe(0)
  })

  it('a duration that names the motion token is not a literal', () => {
    const text = '<i className="duration-[var(--astrid-motion-fast-duration)] duration-[250ms] duration-200" />'
    expect(count(metric('motionLiterals'), source(text))).toBe(2)
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
