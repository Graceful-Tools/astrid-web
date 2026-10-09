/**
 * Selection styling for the task row and the desktop task detail pane.
 *
 * History:
 * - Task 37464d1f — the selected row added a translucent 2px blue GLOW ring
 *   (box-shadow: 0 0 0 2px rgba(59,130,246,.5)) plus a heavier shadow-md, so it
 *   looked unlike every other row. Both were removed and selection read only
 *   through the tinted background.
 * - AWTD-1084 — "add the blue border around the selected row and select task
 *   details on web like on mac app". The Mac app outlines the selected row and
 *   the detail pane with a crisp accent-blue stroke. That is a BORDER, not the
 *   glow 37464d1f objected to: solid, no blur, no heavier drop shadow, and drawn
 *   as an inset outline so the selected row does not grow or shift.
 *
 * CSS can't be exercised behaviorally in jsdom, so we assert the rules' content.
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

const css = readFileSync(join(process.cwd(), 'styles', 'components.css'), 'utf8')

describe('selected task row border (AWTD-1084, after task 37464d1f)', () => {
  const body = ruleBody(css, '.task-row-selected')

  it('AWTD-1084: outlines the selected row with a solid 2px accent-blue border', () => {
    expect(body).toMatch(/outline:\s*2px solid rgb\(var\(--theme-accent\)\)/)
  })

  it('AWTD-1084: draws the border inside the row so selecting does not shift layout', () => {
    expect(body).toMatch(/outline-offset:\s*-2px/)
  })

  it('37464d1f: still no glow ring and no heavier drop shadow than normal rows', () => {
    expect(body.toLowerCase()).not.toContain('box-shadow')
    expect(body).not.toMatch(/shadow-md/)
  })
})

describe('desktop task detail pane border (AWTD-1084)', () => {
  it('rings the pane in the same 2px accent blue instead of the grey theme border', () => {
    const body = ruleBody(css, '.task-panel-desktop')
    expect(body).toMatch(/box-shadow:\s*0 0 0 2px rgb\(var\(--theme-accent\)\)/)
    expect(body).not.toMatch(/0 0 0 1px rgb\(var\(--theme-border\)\)/)
  })

  it('gives the pointer arrow the same blue edge, so row and pane read as one selection', () => {
    const body = ruleBody(css, '.task-panel-desktop > .task-panel-arrow.theme-panel-arrow')
    expect(body).toMatch(/border-left:\s*2px solid rgb\(var\(--theme-accent\)\)/)
    expect(body).toMatch(/border-bottom:\s*2px solid rgb\(var\(--theme-accent\)\)/)
  })

  it('keeps full-screen detail borderless', () => {
    const body = ruleBody(css, '.task-panel-desktop:has([data-fullscreen="true"])')
    expect(body).toMatch(/box-shadow:\s*none/)
  })
})
