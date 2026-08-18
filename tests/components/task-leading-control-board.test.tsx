/**
 * @vitest-environment jsdom
 */

/**
 * The leading control on a BOARD's task, seen in list view (task 036ef139).
 *
 * Jon: "In board view, when in 'list' mode the checkbox when tapped should
 * provide the 'status' picker (inbox, ready, doing, waiting, done, or custom
 * status)."
 *
 * Two properties, and they pull in opposite directions, which is why both are
 * pinned here:
 *
 *   the ACTION changes — tapping opens the sheet instead of completing;
 *   the MARK does not — "the checkbox when tapped" says the checkbox is still
 *   there, so a board must not silently swap in the project-mode avatar for a
 *   user who never chose project display mode.
 *
 * The dead-control rule from task ffa5bbb5 still applies: with no
 * `onOpenOptions` handler, a board task completes rather than becoming a
 * control that does nothing.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { TaskLeadingControl } from '@/components/task-leading-control'

vi.mock('@/lib/i18n/client', () => ({ useTranslations: () => ({ t: (k: string) => k }) }))

const ME = 'user-me'
const THEM = 'user-them'

function tapTheControl(container: HTMLElement) {
  const target = container.querySelector('[class*="cursor-pointer"]')
  expect(target, 'the leading control rendered nothing tappable').toBeTruthy()
  fireEvent.click(target as Element)
}

describe('a board task in list display mode (task 036ef139)', () => {
  it('opens the status picker instead of completing', () => {
    const onToggleComplete = vi.fn()
    const onOpenOptions = vi.fn()
    const { container } = render(
      <TaskLeadingControl
        assigneeId={ME}
        currentUserId={ME}
        completed={false}
        priority={0}
        displayMode="list"
        onBoard
        onToggleComplete={onToggleComplete}
        onOpenOptions={onOpenOptions}
      />,
    )
    tapTheControl(container)
    expect(onOpenOptions).toHaveBeenCalledTimes(1)
    expect(
      onToggleComplete,
      'tapping completed the task instead of opening the picker — the destructive failure',
    ).not.toHaveBeenCalled()
  })

  it('keeps the checkbox as the mark — no avatar swap', () => {
    // The checkbox renders an <img>; the project-mode avatar does not.
    const { container } = render(
      <TaskLeadingControl
        assigneeId={ME}
        currentUserId={ME}
        completed={false}
        priority={0}
        assignee={{ name: 'Jon', email: 'jon@example.com', image: null }}
        displayMode="list"
        onBoard
        onToggleComplete={vi.fn()}
        onOpenOptions={vi.fn()}
      />,
    )
    expect(container.querySelector('img')).toBeTruthy()
  })

  it("makes someone else's task tappable, since the sheet is the only route to state", () => {
    const onOpenOptions = vi.fn()
    const { container } = render(
      <TaskLeadingControl
        assigneeId={THEM}
        currentUserId={ME}
        completed={false}
        priority={1}
        assignee={{ name: 'Sam Smith', email: 'sam@example.com', image: null }}
        displayMode="list"
        onBoard
        onToggleComplete={vi.fn()}
        onOpenOptions={onOpenOptions}
      />,
    )
    tapTheControl(container)
    expect(onOpenOptions).toHaveBeenCalledTimes(1)
  })

  it('falls back to completing when no picker handler is wired', () => {
    const onToggleComplete = vi.fn()
    const { container } = render(
      <TaskLeadingControl
        assigneeId={ME}
        currentUserId={ME}
        completed={false}
        priority={0}
        displayMode="list"
        onBoard
        onToggleComplete={onToggleComplete}
      />,
    )
    tapTheControl(container)
    expect(onToggleComplete).toHaveBeenCalledTimes(1)
  })
})

describe('a task that is not on a board is untouched (task 036ef139)', () => {
  it('still completes on tap', () => {
    const onToggleComplete = vi.fn()
    const onOpenOptions = vi.fn()
    const { container } = render(
      <TaskLeadingControl
        assigneeId={ME}
        currentUserId={ME}
        completed={false}
        priority={0}
        displayMode="list"
        onToggleComplete={onToggleComplete}
        onOpenOptions={onOpenOptions}
      />,
    )
    tapTheControl(container)
    expect(onToggleComplete).toHaveBeenCalledTimes(1)
    expect(onOpenOptions).not.toHaveBeenCalled()
  })
})
