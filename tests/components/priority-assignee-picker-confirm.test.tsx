/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-877: completing SOMEONE ELSE'S task from the options sheet asks first.
 *
 * Jon, for both platforms: "When not yours, always confirm before completing."
 *
 * The confirmation used to be a tap outcome on the leading control in task
 * details (task 43bcc76c) — one surface, and no protection at all in project
 * mode or on a board, where the tap already went to this sheet and its Complete
 * button finished another person's work outright. Moving it here fixes both
 * halves at once: the row and details gain a route to completion, and project
 * mode and boards gain the confirmation they never had.
 *
 * It is decided HERE rather than by the three call sites, because this sheet is
 * now the only route to completion for someone else's task on every one of
 * them. Three call sites deciding separately is exactly how the row came to be
 * inert while details grew a confirm of its own.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PriorityAssigneePicker } from '@/components/priority-assignee-picker'

vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({
    t: (key: string, replacements?: Record<string, string>) =>
      replacements
        ? `${key} ${Object.values(replacements).join(' ')}`.trim()
        : key,
  }),
}))

// The picker fetches list members when it opens.
global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ users: [] }) }) as never

const ME = 'user-me'
const THEM = {
  id: 'user-them',
  name: 'Sam Smith',
  email: 'sam@example.com',
  createdAt: new Date(),
}

function openSheet(props: Record<string, unknown>) {
  return render(
    <PriorityAssigneePicker
      isOpen
      onClose={vi.fn()}
      onSelect={vi.fn()}
      selectedPriority={0}
      selectedAssignee={THEM}
      availableUsers={[]}
      currentUserId={ME}
      completed={false}
      {...props}
    />,
  )
}

const completeButton = () => screen.getByTestId('task-options-complete')

/*
 * ADEV-71 (Jon, 2026-11-17, matching iOS ADEV-79): "Tap the checkbox. It
 * confirms. Completes. Done." The sheet used to show a Complete button that
 * opened a second "Complete this task?" dialog — three taps. For a task that is
 * not yours the sheet now OPENS ON the question, so the checkbox is tap one and
 * the sheet's Complete is tap two.
 */
describe('completing someone else\'s task from the options sheet (AWTD-877, ADEV-71)', () => {
  it('opens on the question itself, naming whose task it is', () => {
    openSheet({ onToggleComplete: vi.fn() })

    // ADEV-158: one muted line, no title above it.
    expect(screen.queryByText('tasks.confirmCompleteTitle')).toBeNull()
    expect(screen.getByText(/Sam Smith/)).toBeTruthy()
    expect(completeButton()).toHaveTextContent('common.complete')
  })

  it('completes on one press of Complete, with no second dialog (ADEV-71)', () => {
    const onToggleComplete = vi.fn()
    openSheet({ onToggleComplete })

    fireEvent.click(completeButton())

    expect(onToggleComplete).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Cancel closes the sheet and completes nothing', () => {
    const onToggleComplete = vi.fn()
    const onClose = vi.fn()
    openSheet({ onToggleComplete, onClose })

    fireEvent.click(screen.getByTestId('task-options-complete-cancel'))

    expect(onToggleComplete).not.toHaveBeenCalled()
  })

  it('reads the viewer off currentUser too, for callers that hold the row', () => {
    openSheet({
      onToggleComplete: vi.fn(),
      currentUserId: undefined,
      currentUser: { id: ME, name: 'Me', email: 'me@example.com', createdAt: new Date() },
    })

    expect(completeButton()).toHaveTextContent('common.complete')
  })
})

describe('what completes without asking (AWTD-877)', () => {
  it('your own task', () => {
    // Trap 1: iOS's project layout puts your own photo on your own task, so a
    // confirmation keyed off the avatar MARK would stop you finishing your own
    // work. This compares ids.
    const onToggleComplete = vi.fn()
    openSheet({
      onToggleComplete,
      selectedAssignee: { id: ME, name: 'Me', email: 'me@example.com', createdAt: new Date() },
    })

    expect(screen.queryByText('tasks.confirmCompleteTitle')).toBeNull()
    fireEvent.click(completeButton())

    expect(onToggleComplete).toHaveBeenCalledTimes(1)
  })

  // An unassigned task used to complete without asking here ("there is nobody
  // the dialog could name"). ADEV-56 asks for it too, saying nobody holds it —
  // see tests/components/adev-56-no-project-layout.test.tsx.

  it('REOPENING someone else\'s task, which takes nothing away from them', () => {
    const onToggleComplete = vi.fn()
    openSheet({ onToggleComplete, completed: true })

    fireEvent.click(completeButton())

    expect(onToggleComplete).toHaveBeenCalledTimes(1)
  })
})
