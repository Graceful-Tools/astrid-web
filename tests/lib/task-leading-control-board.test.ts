/**
 * Tapping the leading control on a BOARD's task opens the status picker
 * (task 036ef139).
 *
 * Jon: "In board view, when in 'list' mode the checkbox when tapped should
 * provide the 'status' picker (inbox, ready, doing, waiting, done, or custom
 * status)", and on the iOS twin: "In List mode, not part of a board, tapping
 * the checkbox should complete the task. In board view, it should bring up a
 * status picker."
 *
 * So what decides is BOARD MEMBERSHIP, not the task-display-mode preference.
 * Until now the only route to the options sheet was `taskDisplayMode:
 * 'project'` — a per-user Appearance setting — which meant a board's own tasks
 * completed on tap for everyone who had never opened Appearance. The two
 * conditions are OR'd rather than swapped: project display mode keeps opening
 * the sheet everywhere, board or not.
 *
 * The MARK is deliberately not part of this rule. Jon said "the checkbox when
 * tapped", so on a board in list display mode the checkbox stays a checkbox and
 * only the action moves — see tests/components/task-leading-control-board.test.tsx.
 */

import { describe, it, expect } from 'vitest'
import { leadingControlOpensOptions } from '@/lib/task-leading-control'

describe('leadingControlOpensOptions (task 036ef139)', () => {
  it('opens the picker for a task on a board, in list display mode', () => {
    expect(leadingControlOpensOptions({ displayMode: 'list', onBoard: true })).toBe(true)
  })

  it('still completes off a board in list display mode', () => {
    expect(leadingControlOpensOptions({ displayMode: 'list', onBoard: false })).toBe(false)
  })

  it('treats an absent board flag as no board', () => {
    // Every call site predating this task omits it and must not change.
    expect(leadingControlOpensOptions({ displayMode: 'list' })).toBe(false)
  })

  it('keeps project display mode opening the picker off a board', () => {
    expect(leadingControlOpensOptions({ displayMode: 'project', onBoard: false })).toBe(true)
  })

  it('opens the picker when both are true', () => {
    expect(leadingControlOpensOptions({ displayMode: 'project', onBoard: true })).toBe(true)
  })

  it('reads an unrecognised display mode as list', () => {
    expect(leadingControlOpensOptions({ displayMode: 'projectt', onBoard: false })).toBe(false)
    expect(leadingControlOpensOptions({ displayMode: null, onBoard: true })).toBe(true)
  })
})
