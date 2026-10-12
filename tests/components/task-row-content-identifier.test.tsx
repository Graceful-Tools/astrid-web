/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1017 — a board card shows the task id, muted. The card decides WHETHER
 * through shouldShowTaskIdentifier('row-board'); the row only renders what it is
 * handed, so list rows (which pass nothing) never do.
 *
 * AWTD-1170 moved WHERE: out of the title line and down into the metadata row
 * that carries the due time and the list pills. The row used to render only for
 * a date, a list or a label, so the id now also brings it into existence —
 * otherwise a card with neither would show no id at all.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Task } from '@/types/task'

vi.mock('@/contexts/feature-flag-context', () => ({
  useFeatureFlags: () => ({ isEnabled: () => true }),
}))

import { TaskRowContent } from '@/components/task-row-content'

const task = {
  id: 't1',
  title: 'Card task',
  identifier: 'AWTD-12',
  completed: false,
  priority: 0,
  repeating: 'never',
  lists: [],
} as unknown as Task

/** A task with the two things the metadata row already carried. */
const dated = {
  ...task,
  dueDateTime: '2026-03-04T17:30:00.000Z',
  isAllDay: false,
  lists: [{ id: 'l1', name: 'Inbox', color: '#4287f5' }],
} as unknown as Task

describe('TaskRowContent identifier (AWTD-1017)', () => {
  it('shows the id it is handed', () => {
    render(<TaskRowContent task={task} identifier="AWTD-12" onToggleComplete={vi.fn()} onCopyPublic={vi.fn()} />)
    expect(screen.getByText('AWTD-12')).toBeTruthy()
  })

  it('shows nothing when no id is handed, even if the task has one', () => {
    render(<TaskRowContent task={task} onToggleComplete={vi.fn()} onCopyPublic={vi.fn()} />)
    expect(screen.queryByText('AWTD-12')).toBeNull()
  })
})

describe('TaskRowContent identifier placement (AWTD-1170)', () => {
  it('renders the id below the title, not inside it', () => {
    const { container } = render(
      <TaskRowContent task={dated} identifier="AWTD-12" onToggleComplete={vi.fn()} onCopyPublic={vi.fn()} />
    )
    const title = container.querySelector('.task-title')
    expect(title).toBeTruthy()
    expect(title!.textContent).toContain('Card task')
    expect(title!.textContent).not.toContain('AWTD-12')
    expect(title!.contains(screen.getByText('AWTD-12'))).toBe(false)
  })

  it('puts the id in the same row as the due time and the list pill, ahead of both', () => {
    render(
      <TaskRowContent task={dated} identifier="AWTD-12" onToggleComplete={vi.fn()} onCopyPublic={vi.fn()} />
    )
    const id = screen.getByText('AWTD-12')
    const time = screen.getByText(/5:30 PM|10:30 AM|9:30 AM/)
    const pill = screen.getByText('Inbox')
    const row = id.parentElement!
    expect(row.contains(time)).toBe(true)
    expect(row.contains(pill)).toBe(true)
    // Ahead of both: DOCUMENT_POSITION_FOLLOWING === 4.
    expect(id.compareDocumentPosition(time) & 4).toBe(4)
    expect(id.compareDocumentPosition(pill) & 4).toBe(4)
  })

  it('still shows the id on a card with no date, no list and no label', () => {
    render(<TaskRowContent task={task} identifier="AWTD-12" onToggleComplete={vi.fn()} onCopyPublic={vi.fn()} />)
    expect(screen.getByText('AWTD-12')).toBeTruthy()
  })
})
