/**
 * The project board feeds its options sheet ITS OWN columns (task ffa5bbb5).
 * The project LAYOUT this file once also covered is gone from web (ADEV-56).
 *
 * Jon asked for "board state (ready, waiting, doing, inbox, custom states if
 * relevant)". The custom states only exist on a project, and the project board
 * is the only surface that has one — list rows deliberately pass no project and
 * get inbox + the user's three states + done.
 *
 * So the thing worth protecting is narrow and specific: the board must feed the
 * options sheet the columns IT built (getProjectBoardColumns, which carries the
 * project's custom states and the list ids backing the defaults), not the plain
 * trio from boardColumnsFor. Both type-check, both render, and the difference
 * only shows on a board that has custom states — which no unit render covers
 * and no compiler catches.
 *
 * Source-level rather than a render, and deliberately so. Rendering this board
 * needs a project, its lists, its status lists, a session and a drag context;
 * the assertion that would survive all that setup is still "did it pass the
 * right columns". This asks that directly. It is a weaker test than a render
 * and a stronger one than nothing, which is the honest trade.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(
  join(process.cwd(), 'components/project-status-board.tsx'),
  'utf8',
)

describe('the project board has no project layout any more (ADEV-56)', () => {
  it('does not read or pass a display mode', () => {
    // Web removed the "project" task layout; the stored value is for native
    // clients only, so the board has nothing to read it for.
    expect(src).not.toMatch(/useUserSettings\(\)/)
    expect(src).not.toMatch(/displayMode=/)
    expect(src).not.toMatch(/usesCompactTaskDetail/)
  })

  it("its task detail is the row pane's, with no display mode either (AITD-679)", () => {
    const view = readFileSync(join(process.cwd(), 'components/TaskManagerView.tsx'), 'utf8')
    const callout = view.slice(view.indexOf('<BoardTaskCallout'))
    expect(callout).toMatch(/taskDetailPaneProps\(\{/)
    expect(callout.slice(0, callout.indexOf('})} />'))).not.toMatch(/displayMode/)
  })

  it("opens the options sheet from someone else's card (AWTD-877)", () => {
    // The only route to reassign, reprioritise or complete-with-confirmation.
    // The compact-mode half of this condition went with the layout.
    expect(src).toMatch(/onOpenOptions=\{\s*isSomeoneElsesTask\(\{/)
  })
})

describe("the sheet gets the board's own columns (task ffa5bbb5)", () => {
  it('passes the project columns, so custom states appear', () => {
    expect(
      src,
      'statusColumns must come from the board\'s getProjectBoardColumns memo',
    ).toMatch(/statusColumns=\{columns\}/)
  })

  it('does NOT fall back to the projectless column set', () => {
    // boardColumnsFor(null) is right for a list row and wrong here: it silently
    // drops every custom state, which is the one thing this wiring exists for.
    expect(src).not.toMatch(/boardColumnsFor\(\s*null\s*\)/)
  })

  it('moves through the same function drag-and-drop uses', () => {
    // Two paths interpreting "done" differently is exactly the drift
    // lib/task-status.ts was written to prevent.
    expect(src).toMatch(/moveTaskToColumn\(task\.id, column\)/)
  })
})
