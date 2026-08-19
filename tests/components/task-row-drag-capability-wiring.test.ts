/**
 * The iPad drag fix is only real if the components actually ask for it.
 *
 * All three pieces below are one-line changes that look inert and are not:
 * `draggable` reading the wrong flag silently disables trackpad dragging on a
 * tablet; the grabber reading the wrong flag leaves an iPad with no touch drag
 * at all (the original bug); and the promote strip losing its id makes
 * "move out of subtask" silently unreachable by touch, because the hook finds
 * that strip by `#PROMOTE_DROP_TARGET_ID` and nothing else.
 *
 * MainContent and TaskRow want a session, a router, SSE and a dozen hooks, so
 * no jsdom test renders them. Pinned at the source instead, same as
 * tests/components/project-board-display-mode.test.ts does for this component.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const mainContent = readFileSync(
  join(process.cwd(), 'components/TaskManager/MainContent/MainContent.tsx'),
  'utf8',
)
const taskRow = readFileSync(
  join(process.cwd(), 'components/TaskManager/MainContent/TaskRow.tsx'),
  'utf8',
)

describe('MainContent drag wiring', () => {
  it('derives the capability from the tested rule rather than inline signals', () => {
    expect(mainContent).toMatch(/from ['"]@\/lib\/touch-drag-sort['"]/)
    expect(mainContent).toMatch(/taskDragCapability\(\{/)
  })

  it('passes BOTH device signals, so a tablet is not mistaken for a phone', () => {
    // isMobilePhoneDevice() is true on an iPad — its UA contains "Mobile" —
    // so the layout signal is what tells them apart.
    expect(mainContent).toMatch(/isMobileLayout:/)
    expect(mainContent).toMatch(/hasPhoneUserAgent:/)
  })

  it('gates the touch listeners on the touch capability, not the phone flag', () => {
    expect(mainContent).toMatch(/isTouchManualSort: dragCapability\.touchDrag/)
  })

  it('wires the promote strip into the touch path in both directions', () => {
    expect(mainContent).toMatch(/onPromoteHover:/)
    expect(mainContent).toMatch(/onDropOnPromoteTarget:/)
  })

  it('gives the promote strip the id the touch path looks for', () => {
    expect(mainContent).toMatch(/id=\{PROMOTE_DROP_TARGET_ID\}/)
  })
})

describe('TaskRow drag wiring', () => {
  it('keeps HTML5 draggable on any device that has a pointer', () => {
    expect(taskRow).toMatch(/draggable=\{dragCapability\.html5Drag\}/)
    expect(taskRow).not.toMatch(/draggable=\{!isTouchManualSort\}/)
  })

  it('renders the grabber wherever touch dragging is supported', () => {
    expect(taskRow).toMatch(/dragCapability\.touchDrag && manualSortActive/)
  })
})
