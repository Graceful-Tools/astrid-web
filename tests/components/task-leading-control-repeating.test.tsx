import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { TaskLeadingControl } from '@/components/task-leading-control'
import en from '@/lib/i18n/locales/en.json'

/**
 * AWTD-1571: a repeating task assigned to someone else, or to nobody, wore the
 * same plain square as a one-off. Only your own task showed the repeat arrows.
 * The arrows are now the border of the photo / "U" mark too.
 */
function renderControl(props: Partial<React.ComponentProps<typeof TaskLeadingControl>> = {}) {
  const onToggleComplete = vi.fn()
  const onOpenOptions = vi.fn()
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TaskLeadingControl
        currentUserId="me"
        completed={false}
        priority={2}
        onToggleComplete={onToggleComplete}
        onOpenOptions={onOpenOptions}
        {...props}
      />
    </NextIntlClientProvider>
  )
  return { onToggleComplete, onOpenOptions }
}

describe('TaskLeadingControl repeating marks (AWTD-1571)', () => {
  it("frames another user's photo in the repeat arrows when the task repeats", () => {
    renderControl({ assigneeId: 'other', assignee: { name: 'Ada Lovelace' }, repeating: true })

    expect(screen.getByTestId('repeat-frame')).toBeInTheDocument()
    expect(screen.getByText('Ad')).toBeInTheDocument()
  })

  it('frames the "U" mark in the repeat arrows when an unassigned task repeats', () => {
    renderControl({ assigneeId: null, repeating: true })

    expect(screen.getByTestId('repeat-frame')).toBeInTheDocument()
    expect(screen.getByText('U')).toBeInTheDocument()
  })

  // AWTD-1574 moved the size itself to the token (34); the rule is unchanged:
  // the frame is the size of every other leading control.
  it("AWTD-1576: the repeat frame is the checkbox's own size, so repeating rows line up", () => {
    renderControl({ assigneeId: 'other', assignee: { name: 'Ada Lovelace' }, repeating: true })
    const frame = screen.getByTestId('repeat-frame')
    expect(frame).toHaveClass('h-leading-control', 'w-leading-control')
    expect(frame).not.toHaveClass('w-10')
  })

  it('draws no repeat frame for a one-off task', () => {
    renderControl({ assigneeId: 'other', assignee: { name: 'Ada Lovelace' } })
    expect(screen.queryByTestId('repeat-frame')).not.toBeInTheDocument()
  })

  it('still opens the options sheet when a repeating photo is tapped', async () => {
    const user = userEvent.setup()
    const { onOpenOptions, onToggleComplete } = renderControl({
      assigneeId: 'other',
      assignee: { name: 'Ada Lovelace' },
      repeating: true,
    })

    await user.click(screen.getByText('Ad'))

    expect(onOpenOptions).toHaveBeenCalledTimes(1)
    expect(onToggleComplete).not.toHaveBeenCalled()
  })
})
