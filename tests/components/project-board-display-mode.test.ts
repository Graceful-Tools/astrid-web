/**
 * The project board wires project mode with ITS OWN columns (task ffa5bbb5).
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

describe('the project board opts into project mode (task ffa5bbb5)', () => {
  it('reads the display mode once for the whole board', () => {
    // Per-row would mean one settings fetch per card.
    expect(src).toMatch(/useUserSettings\(\)/)
    expect((src.match(/useUserSettings\(\)/g) || []).length).toBe(1)
  })

  it('passes the mode to both its rows and its task detail', () => {
    expect((src.match(/displayMode=\{taskDisplayMode\}/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('opens the options sheet from the leading control', () => {
    expect(src).toMatch(/onOpenOptions=\{compact \?/)
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
