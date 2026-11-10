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

const WIDTH = 'var(--selection-outline-width)'
const COLOUR = 'var(--selection-outline-color)'

describe("the selection outline is defined once, from the design tokens (Jon, 2026-11-10: the Mac's)", () => {
  it('is the accent at the token opacity, compact where there is a pointer', () => {
    expect(css).toContain('--selection-outline-width: var(--astrid-size-compact-selection-outline);')
    expect(css).toContain(
      '--selection-outline-color: rgba(var(--theme-accent), var(--astrid-state-selection-outline-opacity));',
    )
  })

  it('is the comfortable width on touch', () => {
    expect(css).toMatch(
      /@media \(pointer: coarse\) \{\s*:root \{\s*--selection-outline-width: var\(--astrid-size-comfortable-selection-outline\);/,
    )
  })
})

describe('selected task row border (AWTD-1084, after task 37464d1f)', () => {
  const body = ruleBody(css, '.task-row-selected')
  // Every row carries the outline's colour, width and offset; selection only
  // switches it on (AWTD-1085, below).
  const card = ruleBody(css, '.task-card')

  it('AWTD-1084: outlines the selected row with a solid accent border', () => {
    expect(card).toContain(`outline: ${WIDTH} none ${COLOUR};`)
    expect(body).toMatch(/outline-style:\s*solid/)
  })

  it('AWTD-1084: draws the border inside the row so selecting does not shift layout', () => {
    expect(card).toContain(`outline-offset: calc(-1 * ${WIDTH});`)
  })

  // Rows carry transition-theme (transition-all). If selection set the outline
  // colour, the new outline animated in from the default currentColor — the
  // dark text colour — so the border flashed black for ~200ms before turning
  // blue. outline-style is discrete and never animates, so selection must
  // change nothing else.
  it('AWTD-1085: selecting changes only outline-style, so the border never animates from black', () => {
    expect(body).not.toMatch(/outline:/)
    expect(body).not.toMatch(/outline-(color|width|offset)/)
  })

  it('37464d1f: still no glow ring and no heavier drop shadow than normal rows', () => {
    expect(body.toLowerCase()).not.toContain('box-shadow')
    expect(body).not.toMatch(/shadow-md/)
  })
})

describe('desktop task detail pane border (AWTD-1084)', () => {
  it('rings the pane in the same outline as the row instead of the grey theme border', () => {
    const body = ruleBody(css, '.task-panel-desktop')
    expect(body).toContain(`box-shadow: 0 0 0 ${WIDTH} ${COLOUR}`)
    expect(body).not.toMatch(/0 0 0 1px rgb\(var\(--theme-border\)\)/)
  })

  it('gives the pointer arrow the same blue edge, so row and pane read as one selection', () => {
    const body = ruleBody(css, '.task-panel-desktop > .task-panel-arrow.theme-panel-arrow')
    expect(body).toContain(`border-left: ${WIDTH} solid ${COLOUR};`)
    expect(body).toContain(`border-bottom: ${WIDTH} solid ${COLOUR};`)
  })

  it('keeps full-screen detail borderless', () => {
    const body = ruleBody(css, '.task-panel-desktop:has([data-fullscreen="true"])')
    expect(body).toMatch(/box-shadow:\s*none/)
  })
})
