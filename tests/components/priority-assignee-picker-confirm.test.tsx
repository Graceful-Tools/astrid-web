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
const confirmButton = () => screen.getByRole('button', { name: 'common.complete' })

describe('completing someone else\'s task from the options sheet (AWTD-877)', () => {
  it('asks rather than completing on the first press', () => {
    const onToggleComplete = vi.fn()
    openSheet({ onToggleComplete })

    fireEvent.click(completeButton())

    expect(onToggleComplete).not.toHaveBeenCalled()
    expect(confirmButton()).toBeTruthy()
  })

  it('completes once the confirmation is accepted', () => {
    const onToggleComplete = vi.fn()
    openSheet({ onToggleComplete })

    fireEvent.click(completeButton())
    fireEvent.click(confirmButton())

    expect(onToggleComplete).toHaveBeenCalledTimes(1)
  })

  it('completes nothing when the confirmation is dismissed', () => {
    const onToggleComplete = vi.fn()
    openSheet({ onToggleComplete })

    fireEvent.click(completeButton())
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(onToggleComplete).not.toHaveBeenCalled()
  })

  it('names the person whose task it is, so the confirmation is not blind', () => {
    openSheet({ onToggleComplete: vi.fn() })

    fireEvent.click(completeButton())

    expect(screen.getByText(/Sam Smith/)).toBeTruthy()
  })

  it('reads the viewer off currentUser too, for callers that hold the row', () => {
    const onToggleComplete = vi.fn()
    openSheet({
      onToggleComplete,
      currentUserId: undefined,
      currentUser: { id: ME, name: 'Me', email: 'me@example.com', createdAt: new Date() },
    })

    fireEvent.click(completeButton())

    expect(onToggleComplete).not.toHaveBeenCalled()
  })
})

describe('what completes without asking (AWTD-877)', () => {
  it('your own task', () => {
    // Trap 1: in project mode your own task wears your photo too, so a
    // confirmation keyed off the avatar MARK would stop you finishing your own
    // work. This compares ids.
    const onToggleComplete = vi.fn()
    openSheet({
      onToggleComplete,
      selectedAssignee: { id: ME, name: 'Me', email: 'me@example.com', createdAt: new Date() },
    })

    fireEvent.click(completeButton())

    expect(onToggleComplete).toHaveBeenCalledTimes(1)
  })

  it('an unassigned task — there is nobody the dialog could name', () => {
    const onToggleComplete = vi.fn()
    openSheet({ onToggleComplete, selectedAssignee: null })

    fireEvent.click(completeButton())

    expect(onToggleComplete).toHaveBeenCalledTimes(1)
  })

  it('REOPENING someone else\'s task, which takes nothing away from them', () => {
    const onToggleComplete = vi.fn()
    openSheet({ onToggleComplete, completed: true })

    fireEvent.click(completeButton())

    expect(onToggleComplete).toHaveBeenCalledTimes(1)
  })
})
