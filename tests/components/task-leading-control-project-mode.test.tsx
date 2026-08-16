/**
 * @vitest-environment jsdom
 */

/**
 * What tapping the leading control does, per display mode (task ffa5bbb5).
 *
 * Jon: "In project view ... Instead of completing the task a popover with these
 * options is revealed."
 *
 * So project mode inverts the one thing lib/task-leading-control.ts had always
 * held constant. The risk being tested for is a mode that changes the MARK but
 * not the ACTION: your photo appears, you tap it expecting options, and the
 * task silently completes instead. That is worse than the current behaviour,
 * because it destroys work rather than merely looking wrong.
 *
 * THE OTHER-PERSON CASE IS DELIBERATE. In list mode someone else's avatar is
 * not clickable at all — completing another person's task from the row was
 * never an affordance. In project mode it must be, because the popover is the
 * only route to assignee, priority and state; leaving it inert would make
 * another person's task uneditable from the board.
 *
 * AND THE FALLBACK. Project mode with no onOpenOptions handler still completes,
 * so a call site that has not yet been given a popover degrades to today's
 * behaviour rather than becoming a control that does nothing.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { TaskLeadingControl } from '@/components/task-leading-control'

vi.mock('@/lib/i18n/client', () => ({ useTranslations: () => ({ t: (k: string) => k }) }))

const ME = 'user-me'
const THEM = 'user-them'
const THEIR_AVATAR = { name: 'Sam Smith', email: 'sam@example.com', image: null }

/**
 * Tap the control, whatever mark it is wearing.
 *
 * Queried by the cursor-pointer wrapper rather than by role: TaskCheckbox is a
 * plain div with an onClick and no role at all, and the unassigned mark is a
 * role="button" div. Asserting on the affordance the three share is the point —
 * "is it tappable" is exactly what this file is about.
 */
function tapTheControl(container: HTMLElement) {
  const target = container.querySelector('[class*="cursor-pointer"]')
  expect(target, 'the leading control rendered nothing tappable').toBeTruthy()
  fireEvent.click(target as Element)
}

describe('list mode: tapping completes, as it always has (task ffa5bbb5)', () => {
  it('your own task completes', () => {
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
    // Present but unused: the handler existing must not change list mode.
    expect(onOpenOptions).not.toHaveBeenCalled()
  })

  it('an unassigned task completes', () => {
    const onToggleComplete = vi.fn()
    const { container } = render(
      <TaskLeadingControl
        assigneeId={null}
        currentUserId={ME}
        completed={false}
        priority={2}
        displayMode="list"
        onToggleComplete={onToggleComplete}
      />,
    )
    tapTheControl(container)
    expect(onToggleComplete).toHaveBeenCalledTimes(1)
  })
})

describe('project mode: tapping opens the options popover (task ffa5bbb5)', () => {
  it('your own task opens options and does NOT complete', () => {
    const onToggleComplete = vi.fn()
    const onOpenOptions = vi.fn()
    const { container } = render(
      <TaskLeadingControl
        assigneeId={ME}
        currentUserId={ME}
        completed={false}
        priority={0}
        assignee={{ name: 'Jon', email: 'jon@example.com', image: null }}
        displayMode="project"
        onToggleComplete={onToggleComplete}
        onOpenOptions={onOpenOptions}
      />,
    )
    tapTheControl(container)
    expect(onOpenOptions).toHaveBeenCalledTimes(1)
    expect(
      onToggleComplete,
      'tapping completed the task instead of opening options — the destructive failure',
    ).not.toHaveBeenCalled()
  })

  it("someone else's task becomes tappable and opens options", () => {
    const onOpenOptions = vi.fn()
    const { container } = render(
      <TaskLeadingControl
        assigneeId={THEM}
        currentUserId={ME}
        completed={false}
        priority={1}
        assignee={THEIR_AVATAR}
        displayMode="project"
        onToggleComplete={vi.fn()}
        onOpenOptions={onOpenOptions}
      />,
    )
    tapTheControl(container)
    expect(onOpenOptions).toHaveBeenCalledTimes(1)
  })

  it('an unassigned task opens options', () => {
    const onOpenOptions = vi.fn()
    const onToggleComplete = vi.fn()
    const { container } = render(
      <TaskLeadingControl
        assigneeId={null}
        currentUserId={ME}
        completed={false}
        priority={3}
        displayMode="project"
        onToggleComplete={onToggleComplete}
        onOpenOptions={onOpenOptions}
      />,
    )
    tapTheControl(container)
    expect(onOpenOptions).toHaveBeenCalledTimes(1)
    expect(onToggleComplete).not.toHaveBeenCalled()
  })

  it('falls back to completing when no popover handler is wired', () => {
    // A control that does nothing is a worse regression than one that behaves
    // like list mode.
    const onToggleComplete = vi.fn()
    const { container } = render(
      <TaskLeadingControl
        assigneeId={ME}
        currentUserId={ME}
        completed={false}
        priority={0}
        assignee={{ name: 'Jon', email: 'jon@example.com', image: null }}
        displayMode="project"
        onToggleComplete={onToggleComplete}
      />,
    )
    tapTheControl(container)
    expect(onToggleComplete).toHaveBeenCalledTimes(1)
  })
})
