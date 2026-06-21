import { describe, it, expect } from 'vitest'
import { computeTaskPaneLeftOffset, TASK_PANE_GAP } from '@/components/TaskManager/task-pane-position'

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
