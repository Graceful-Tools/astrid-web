import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { TaskLeadingControl } from '@/components/task-leading-control'
import en from '@/lib/i18n/locales/en.json'

/**
 * The rendered half of task 2bb1b196: three distinct marks for three distinct
 * states, and the same completion action behind all of them.
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
    expect(screen.queryByAltText(/checkbox/i)).not.toBeInTheDocument()
  })

  it('renders the checkbox when the task is yours', () => {
    renderControl({ assigneeId: 'me' })

    expect(screen.getByAltText(/unchecked.*checkbox/i)).toBeInTheDocument()
    expect(screen.queryByText('U')).not.toBeInTheDocument()
  })

  it('renders the assignee mark, not a checkbox, when the task is someone else\'s', () => {
    renderControl({ assigneeId: 'other', assignee: { name: 'Ada Lovelace' } })

    expect(screen.getByText('Ad')).toBeInTheDocument()
    expect(screen.queryByAltText(/checkbox/i)).not.toBeInTheDocument()
  })

  it('still completes the task when the "U" mark is clicked — the mark changed, the action did not', async () => {
    const user = userEvent.setup()
    const { onToggleComplete } = renderControl({ assigneeId: null })

    await user.click(screen.getByText('U'))

    expect(onToggleComplete).toHaveBeenCalledTimes(1)
  })

  it('completes the task from the keyboard, so the "U" mark is not mouse-only', async () => {
    const user = userEvent.setup()
    const { onToggleComplete } = renderControl({ assigneeId: null })

    await user.tab()
    await user.keyboard('{Enter}')

    expect(onToggleComplete).toHaveBeenCalledTimes(1)
  })

  it('uses the checkbox for a completed unassigned task so its done state stays legible', () => {
    renderControl({ assigneeId: null, completed: true })

    expect(screen.getByAltText(/^checked.*checkbox/i)).toBeInTheDocument()
    expect(screen.queryByText('U')).not.toBeInTheDocument()
  })
})
