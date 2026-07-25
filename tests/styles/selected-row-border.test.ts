/**
 * Regression for task 37464d1f — "use same selected task row border as the
 * incomplete tasks."
 *
 * The selected task row used to add a 2px blue glow ring
 * (box-shadow: 0 0 0 2px rgba(59,130,246,.5)) plus a heavier shadow-md, so it
 * looked different from normal/incomplete rows (thin theme border + subtle
 * shadow from .task-card). Selection should instead read via the tinted
 * background (theme-bg-selected) and keep the SAME border/shadow as incomplete
 * rows.
 *
 * CSS can't be exercised behaviorally in jsdom, so we assert the rule's content:
 * .task-row-selected must not reintroduce the blue ring or the heavier shadow.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(selector + ' {')
  if (start === -1) throw new Error(`selector ${selector} not found`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

describe('selected task row border (task 37464d1f)', () => {
  const css = readFileSync(
    join(process.cwd(), 'styles', 'components.css'),
    'utf8',
  )
  const body = ruleBody(css, '.task-row-selected')

  it('does not add a blue glow ring (matches the incomplete-row border)', () => {
    // The blue ring color; must not be present in the selected-row rule.
    expect(body).not.toMatch(/59,\s*130,\s*246/)
    expect(body.toLowerCase()).not.toContain('box-shadow')
  })

  it('does not add a heavier drop shadow than normal rows', () => {
    expect(body).not.toMatch(/shadow-md/)
  })
})
