import { describe, it, expect } from 'vitest'
import {
  computeTaskPaneLeftOffset,
  TASK_PANE_GAP,
  TASK_PANE_LEFT_NUDGE,
  TASK_PANE_MIN_WIDTH,
  TASK_PANE_RIGHT_INSET,
} from '@/components/TaskManager/task-pane-position'

describe('computeTaskPaneLeftOffset', () => {
  const SIDEBAR = 200
  const MAIN = 600

  it('2-column: panel sits after main content only (sidebar is a hamburger overlay)', () => {
    expect(
      computeTaskPaneLeftOffset(SIDEBAR, MAIN, { is2Column: true, is3Column: false, showHamburgerMenu: false }),
    ).toBe(MAIN + TASK_PANE_GAP)
  })

  it('3-column: panel sits after sidebar + main content', () => {
    expect(
      computeTaskPaneLeftOffset(SIDEBAR, MAIN, { is2Column: false, is3Column: true, showHamburgerMenu: false }),
    ).toBe(SIDEBAR + MAIN + TASK_PANE_GAP)
  })

  it('fallback with hamburger menu: after main content only', () => {
    expect(
      computeTaskPaneLeftOffset(SIDEBAR, MAIN, { is2Column: false, is3Column: false, showHamburgerMenu: true }),
    ).toBe(MAIN + TASK_PANE_GAP)
  })

  it('fallback without hamburger menu: after sidebar + main content', () => {
    expect(
      computeTaskPaneLeftOffset(SIDEBAR, MAIN, { is2Column: false, is3Column: false, showHamburgerMenu: false }),
    ).toBe(SIDEBAR + MAIN + TASK_PANE_GAP)
  })
})

/**
 * AWTD-1205: the detail pane must always be on screen.
 *
 * The pane is `position: fixed` with `min-width: 350px`, rendered at
 * `left: offset - 18; right: 10; width: auto`. `width: auto` would shrink it to
 * fit, but `min-width` overrules that — so once the offset grows past the point
 * where 350px still fits, the pane simply extends past the right edge and the
 * part you need is not on screen.
 *
 * It grows when the messages panel is hidden: the main content expands into the
 * space it vacated, and the offset is sidebar + main + gap.
 */
describe('computeTaskPaneLeftOffset keeps the pane on screen (AWTD-1205)', () => {
  const layout3 = { is2Column: false, is3Column: true, showHamburgerMenu: false }

  it('is unchanged when the pane already fits', () => {
    // 200 + 600 + 20 = 820, and 820 - 18 + 350 = 1152 <= 1400 - 10.
    expect(computeTaskPaneLeftOffset(200, 600, layout3, 1400)).toBe(820)
  })

  it('clamps so the pane keeps its full minimum width inside the viewport', () => {
    // Messages hidden: main has expanded, so the ideal offset is far right.
    const clamped = computeTaskPaneLeftOffset(200, 900, layout3, 1200)
    expect(clamped).toBeLessThan(200 + 900 + TASK_PANE_GAP)
    // The rendered box is [offset - 18, viewport - 10]; it must be >= the min.
    expect(1200 - TASK_PANE_RIGHT_INSET - (clamped - TASK_PANE_LEFT_NUDGE)).toBe(TASK_PANE_MIN_WIDTH)
  })

  it('never returns a negative offset, however narrow the viewport', () => {
    expect(computeTaskPaneLeftOffset(200, 900, layout3, 300)).toBe(0)
  })

  it('leaves every layout alone when no viewport is given', () => {
    // The caller measures the window; without that reading there is nothing to
    // clamp against, and guessing one would move the pane on a server render.
    expect(computeTaskPaneLeftOffset(200, 900, layout3)).toBe(200 + 900 + TASK_PANE_GAP)
    expect(computeTaskPaneLeftOffset(200, 900, { ...layout3, is3Column: false, is2Column: true })).toBe(900 + TASK_PANE_GAP)
  })

  it('clamps the 2-column layout too — the pane is the same fixed box there', () => {
    expect(computeTaskPaneLeftOffset(0, 1100, { is2Column: true, is3Column: false, showHamburgerMenu: false }, 1200))
      .toBe(1200 - TASK_PANE_RIGHT_INSET - TASK_PANE_MIN_WIDTH + TASK_PANE_LEFT_NUDGE)
  })
})
