import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { TaskLeadingControl } from '@/components/task-leading-control'
import en from '@/lib/i18n/locales/en.json'

/**
 * The rendered half of task 2bb1b196: three distinct marks for three distinct
 * states. Completing a task that is not yours asks first (ADEV-56).
 */
function renderControl(props: Partial<React.ComponentProps<typeof TaskLeadingControl>> = {}) {
  const onToggleComplete = vi.fn()
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TaskLeadingControl
        currentUserId="me"
        completed={false}
        priority={0}
        onToggleComplete={onToggleComplete}
        {...props}
      />
    </NextIntlClientProvider>
  )
  return { onToggleComplete }
}

describe('TaskLeadingControl (task 2bb1b196)', () => {
  it('renders the "U" mark, not a checkbox, when nobody owns the task', () => {
    renderControl({ assigneeId: null })

    expect(screen.getByText('U')).toBeInTheDocument()
    expect(screen.queryByTestId('task-checkbox-art')).not.toBeInTheDocument()
  })

  it('renders the checkbox when the task is yours', () => {
    renderControl({ assigneeId: 'me' })

    expect(screen.getByTestId('task-checkbox-art')).toHaveAttribute('data-checked', 'false')
    expect(screen.queryByText('U')).not.toBeInTheDocument()
  })

  it('renders the assignee mark, not a checkbox, when the task is someone else\'s', () => {
    renderControl({ assigneeId: 'other', assignee: { name: 'Ada Lovelace' } })

    expect(screen.getByText('Ad')).toBeInTheDocument()
    expect(screen.queryByTestId('task-checkbox-art')).not.toBeInTheDocument()
  })

  it('completes the task when the "U" mark is clicked, once the ADEV-56 confirmation is accepted', async () => {
    // With no options sheet wired, the "U" completes directly — but a task
    // nobody owns is not yours, so it asks first (ADEV-56).
    const user = userEvent.setup()
    const { onToggleComplete } = renderControl({ assigneeId: null })

    await user.click(screen.getByText('U'))
    expect(onToggleComplete).not.toHaveBeenCalled()
    expect(screen.getByText(en.tasks.confirmCompleteUnassigned)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: en.common.complete }))
    expect(onToggleComplete).toHaveBeenCalledTimes(1)
  })

  it('reaches the same confirmation from the keyboard, so the "U" mark is not mouse-only', async () => {
    const user = userEvent.setup()
    const { onToggleComplete } = renderControl({ assigneeId: null })

    await user.tab()
    await user.keyboard('{Enter}')
    await user.click(screen.getByRole('button', { name: en.common.complete }))

    expect(onToggleComplete).toHaveBeenCalledTimes(1)
  })

  it('uses the checkbox for a completed unassigned task so its done state stays legible', () => {
    renderControl({ assigneeId: null, completed: true })

    expect(screen.getByTestId('task-checkbox-art')).toHaveAttribute('data-checked', 'true')
    expect(screen.queryByText('U')).not.toBeInTheDocument()
  })
})
