/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-877 (web half of astrid-ios AITD-375): what tapping the leading control
 * on SOMEONE ELSE'S task does, on every surface.
 *
 * Jon, for both platforms: "When not yours, always confirm before completing.
 * On web and iOS it should give the popover to show assignment, complete,
 * priority and status options just like in project mode."
 *
 * This file replaces the task-43bcc76c version, which pinned the answer this
 * supersedes: a confirm-on-tap that existed in task details and nowhere else,
 * while a row left the same avatar completely inert. Both are gone. The tap
 * opens the options sheet everywhere, and the confirmation moved onto that
 * sheet's Complete button — see priority-assignee-picker-confirm.test.tsx.
 *
 * What has NOT changed is the hazard the old row was protecting against: a
 * stray tap on a small photo must never finish another person's work. It
 * cannot here either, because the tap now opens a sheet rather than completing.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { TaskLeadingControl } from '@/components/task-leading-control'

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

function renderControl(props: Record<string, unknown>) {
  return render(
    <TaskLeadingControl
      assigneeId={THEM}
      currentUserId={ME}
      assignee={THEIR_AVATAR}
      completed={false}
      priority={0}
      onToggleComplete={vi.fn()}
      displayMode="list"
      {...props}
    />,
  )
}

/** The one tappable thing the control put on screen. */
function theTappableMark(container: HTMLElement): Element {
  const target = container.querySelector('[class*="cursor-pointer"]')
  expect(target, 'the leading control rendered nothing tappable').toBeTruthy()
  return target as Element
}

describe('someone else\'s task opens the options sheet (AWTD-877)', () => {
  // Every surface, both display modes. The point of the rule is that one task
  // stops behaving three different ways depending on where you meet it.
  for (const [surface, extraProps] of [
    ['a plain list row', {}],
    ['task details', {}],
    ['a board card', { onBoard: true }],
    ['project mode', { displayMode: 'project' }],
  ] as const) {
    it(`opens it from ${surface}, rather than completing`, () => {
      const onToggleComplete = vi.fn()
      const onOpenOptions = vi.fn()
      const { container } = renderControl({ ...extraProps, onToggleComplete, onOpenOptions })

      fireEvent.click(theTappableMark(container))

      expect(onOpenOptions).toHaveBeenCalledTimes(1)
      expect(onToggleComplete).not.toHaveBeenCalled()
    })
  }

  it('opens it from the keyboard too', () => {
    const onOpenOptions = vi.fn()
    const { container } = renderControl({ onOpenOptions })

    fireEvent.keyDown(theTappableMark(container), { key: 'Enter' })

    expect(onOpenOptions).toHaveBeenCalledTimes(1)
  })

  it('is labelled as options, not as completion', () => {
    const { container } = renderControl({ onOpenOptions: vi.fn() })

    expect(theTappableMark(container).getAttribute('aria-label')).toBe('tasks.taskOptions')
  })
})

describe('what must not change (AWTD-877)', () => {
  it('stays inert where the call site offers no sheet, rather than completing their task', () => {
    // A mark that does nothing is the safer half of the trade: an avatar that
    // silently finishes another person's work on a stray tap is the hazard the
    // row has always refused.
    const onToggleComplete = vi.fn()
    const { container } = renderControl({ onToggleComplete })

    expect(container.querySelector('[class*="cursor-pointer"]')).toBeNull()
    expect(onToggleComplete).not.toHaveBeenCalled()
  })

  it('completes your OWN task on the tap, with no sheet and no confirmation', () => {
    const onToggleComplete = vi.fn()
    const onOpenOptions = vi.fn()
    const { container } = renderControl({
      assigneeId: ME,
      assignee: null,
      onToggleComplete,
      onOpenOptions,
    })

    fireEvent.click(theTappableMark(container))

    expect(onToggleComplete).toHaveBeenCalledTimes(1)
    expect(onOpenOptions).not.toHaveBeenCalled()
  })

  it('completes an UNASSIGNED task on the tap — nobody\'s work is being finished', () => {
    const onToggleComplete = vi.fn()
    const onOpenOptions = vi.fn()
    const { container } = renderControl({
      assigneeId: null,
      assignee: null,
      onToggleComplete,
      onOpenOptions,
    })

    fireEvent.click(theTappableMark(container))

    expect(onToggleComplete).toHaveBeenCalledTimes(1)
    expect(onOpenOptions).not.toHaveBeenCalled()
  })
})
