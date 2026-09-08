/**
 * @vitest-environment jsdom
 */

/**
 * Task 43bcc76c: completing someone else's task from task DETAILS, in list mode.
 *
 * Jon: "in task details cannot complete tasks when user in list mode. Tapping
 * on profile should show popover with confirmation to complete."
 *
 * The leading control is the only completion affordance in details, and for a
 * task assigned to someone else it rendered a plain div with no handler — so
 * the task could not be completed at all. The first test here is that bug: it
 * fails against the control as it was, because nothing in the output was
 * tappable.
 *
 * THE CONFIRMATION IS THE POINT, not just the click. This is another person's
 * task, and the row deliberately refuses to complete it at all. Details may not
 * quietly become a surface where a stray tap on a photo completes someone
 * else's work — so a tap that completes immediately is as wrong as no tap.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskLeadingControl } from '@/components/task-leading-control'

// Mirrors the real t(): key passthrough, but replacements ARE substituted —
// otherwise a confirmation that forgot to pass the name would still pass.
vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({
    t: (key: string, replacements?: Record<string, string>) =>
      replacements
        ? `${key} ${Object.values(replacements).join(' ')}`.trim()
        : key,
  }),
}))

const ME = 'user-me'
const THEM = 'user-them'
const THEIR_AVATAR = { name: 'Sam Smith', email: 'sam@example.com', image: null }

function theirTaskInDetails(onToggleComplete: () => void) {
  return render(
    <TaskLeadingControl
      assigneeId={THEM}
      currentUserId={ME}
      assignee={THEIR_AVATAR}
      completed={false}
      priority={0}
      onToggleComplete={onToggleComplete}
      displayMode="list"
      surface="detail"
    />,
  )
}

/** The one tappable thing the control put on screen. */
function theTappableMark(container: HTMLElement): Element {
  const target = container.querySelector('[class*="cursor-pointer"]')
  expect(target, 'the leading control rendered nothing tappable').toBeTruthy()
  return target as Element
}

describe('someone else\'s task, in details, in list mode (task 43bcc76c)', () => {
  it('is tappable at all — it was not, which is the bug', () => {
    const onToggleComplete = vi.fn()
    const { container } = theirTaskInDetails(onToggleComplete)

    expect(container.querySelector('[class*="cursor-pointer"]')).toBeTruthy()
  })

  it('asks before completing, rather than completing on the tap', () => {
    const onToggleComplete = vi.fn()
    const { container } = theirTaskInDetails(onToggleComplete)

    fireEvent.click(theTappableMark(container))

    expect(onToggleComplete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'common.complete' })).toBeTruthy()
  })

  it('completes once the confirmation is accepted', () => {
    const onToggleComplete = vi.fn()
    const { container } = theirTaskInDetails(onToggleComplete)

    fireEvent.click(theTappableMark(container))
    fireEvent.click(screen.getByRole('button', { name: 'common.complete' }))

    expect(onToggleComplete).toHaveBeenCalledTimes(1)
  })

  it('completes nothing if the confirmation is dismissed', () => {
    const onToggleComplete = vi.fn()
    const { container } = theirTaskInDetails(onToggleComplete)

    fireEvent.click(theTappableMark(container))
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(onToggleComplete).not.toHaveBeenCalled()
  })

  it('names the person whose task it is, so the confirmation is not blind', () => {
    const { container } = theirTaskInDetails(vi.fn())

    fireEvent.click(theTappableMark(container))

    expect(screen.getByText(/Sam Smith/)).toBeTruthy()
  })
})

describe('what must not change (task 43bcc76c)', () => {
  it('leaves the ROW inert — completing another person\'s task there is still not an affordance', () => {
    const onToggleComplete = vi.fn()
    const { container } = render(
      <TaskLeadingControl
        assigneeId={THEM}
        currentUserId={ME}
        assignee={THEIR_AVATAR}
        completed={false}
        priority={0}
        onToggleComplete={onToggleComplete}
        displayMode="list"
      />,
    )

    expect(container.querySelector('[class*="cursor-pointer"]')).toBeNull()
    expect(onToggleComplete).not.toHaveBeenCalled()
  })

  it('completes your OWN task in details on the tap, with no confirmation', () => {
    const onToggleComplete = vi.fn()
    const { container } = render(
      <TaskLeadingControl
        assigneeId={ME}
        currentUserId={ME}
        completed={false}
        priority={0}
        onToggleComplete={onToggleComplete}
        displayMode="list"
        surface="detail"
      />,
    )

    fireEvent.click(theTappableMark(container))

    expect(onToggleComplete).toHaveBeenCalledTimes(1)
  })

  it('still opens the options sheet in project mode, rather than confirming', () => {
    const onToggleComplete = vi.fn()
    const onOpenOptions = vi.fn()
    const { container } = render(
      <TaskLeadingControl
        assigneeId={THEM}
        currentUserId={ME}
        assignee={THEIR_AVATAR}
        completed={false}
        priority={0}
        onToggleComplete={onToggleComplete}
        displayMode="project"
        onOpenOptions={onOpenOptions}
        surface="detail"
      />,
    )

    fireEvent.click(theTappableMark(container))

    expect(onOpenOptions).toHaveBeenCalledTimes(1)
    expect(onToggleComplete).not.toHaveBeenCalled()
  })
})
