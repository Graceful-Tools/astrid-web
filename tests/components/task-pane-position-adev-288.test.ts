/**
 * ADEV-288 — "task details opens in wrong location on web … sometimes, when
 * list view is open".
 *
 * The list-view details pane is `position: fixed` at a left offset measured
 * from the sidebar and the main column. Two holes:
 *
 * 1. A collapsed sidebar renders the rail, which never attached `sidebarRef`.
 *    The measuring effect required that ref, so it never ran: the pane opened at
 *    the initial `left: 0`, over the list (Jon's first screenshot), or kept an
 *    offset measured while the sidebar was open, too far right over the chat
 *    (the second).
 * 2. It re-measured only on open and on window resize. Collapsing or opening
 *    the sidebar moves the main column without resizing the window.
 *
 * Now the offset comes from the main column's own rect (whatever sits to its
 * left: the sidebar, the rail or nothing), and a ResizeObserver on the column
 * re-measures it whenever its width changes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  computeTaskPaneLeftOffset,
  taskPaneLeftOffsetFromMainRect,
  TASK_PANE_GAP,
} from '@/components/TaskManager/task-pane-position'

const THREE = { is2Column: false, is3Column: true, showHamburgerMenu: false }
const TWO = { is2Column: true, is3Column: false, showHamburgerMenu: false }

describe('taskPaneLeftOffsetFromMainRect (ADEV-288)', () => {
  it('with the sidebar open, matches the sidebar + main measurement it replaces', () => {
    expect(taskPaneLeftOffsetFromMainRect({ left: 280, width: 700 }, THREE, 2400))
      .toBe(computeTaskPaneLeftOffset(280, 700, THREE, 2400))
  })

  it('with the sidebar collapsed to its rail, sits after the rail and the list, never at 0', () => {
    expect(taskPaneLeftOffsetFromMainRect({ left: 48, width: 932 }, THREE, 2400)).toBe(48 + 932 + TASK_PANE_GAP)
  })

  it('2-column still ignores what is to the left', () => {
    expect(taskPaneLeftOffsetFromMainRect({ left: 0, width: 700 }, TWO, 1400)).toBe(700 + TASK_PANE_GAP)
  })
})

describe('the measuring hook (ADEV-288)', () => {
  const effect = readFileSync(join(process.cwd(), 'hooks/task-manager/useTaskPanePositionMeasure.ts'), 'utf8')
  const view = readFileSync(join(process.cwd(), 'components/TaskManagerView.tsx'), 'utf8')

  it('is what TaskManagerView uses', () => {
    expect(view).toContain('useTaskPanePositionMeasure({')
    expect(view).not.toContain('sidebarRef.current')
  })

  it('does not need the sidebar ref, which the collapsed rail never attaches', () => {
    expect(effect).not.toContain('sidebarRef.current')
    expect(effect).toContain('taskPaneLeftOffsetFromMainRect(')
  })

  it('re-measures when the main column resizes, not only on window resize', () => {
    expect(effect).toContain('new ResizeObserver(')
    expect(effect).toMatch(/\.observe\(taskManagerRef\.current\)/)
  })
})
