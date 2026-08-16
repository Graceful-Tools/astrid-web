/**
 * @vitest-environment jsdom
 */

/**
 * The options popover gains board state and completion (task ffa5bbb5).
 *
 * Jon: "Board state (ready, waiting, doing, inbox, custom states if relevant)
 * should also be a selector next priority and assignee picker", and in project
 * mode "priority and assignee and complete/mark as incomplete are accessed by
 * tapping on the checkbox".
 *
 * "Next to the priority and assignee picker" is taken literally: this extends
 * PriorityAssigneePicker rather than adding a second sheet. That component
 * already carries priority and assignee and is already the thing mobile quick
 * add opens.
 *
 * BOTH ADDITIONS ARE OPTIONAL, and that is the property most worth testing.
 * mobile-quick-add opens this picker for a task that does not exist yet — it
 * has no id, no board and no completion state — so a state selector that always
 * rendered would be offering to move a task that cannot be moved. Sections
 * appear only when their props do.
 *
 * COLUMNS COME FROM lib/task-status.ts, not from a local list. Status is a
 * state on the task (AWTD-562) with per-project custom states, so a hardcoded
 * ready/doing/waiting here would be wrong on exactly the boards Jon means by
 * "custom states if relevant".
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PriorityAssigneePicker } from '@/components/priority-assignee-picker'
import { boardColumnsFor, INBOX_COLUMN_ID, DONE_COLUMN_ID } from '@/lib/task-status'

vi.mock('@/lib/i18n/client', () => ({ useTranslations: () => ({ t: (k: string) => k }) }))

// The picker fetches list members when it opens.
global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ users: [] }) }) as never

const BASE = {
  isOpen: true,
  onClose: vi.fn(),
  onSelect: vi.fn(),
  selectedPriority: 0,
  selectedAssignee: null,
  availableUsers: [],
}

describe('the picker without the new props is unchanged (task ffa5bbb5)', () => {
  it('renders no board state section', () => {
    // mobile-quick-add's case: a task that does not exist yet cannot be moved
    // to a column, so offering the move would be a lie.
    render(<PriorityAssigneePicker {...BASE} />)
    expect(screen.queryByRole('group', { name: /board state/i })).not.toBeInTheDocument()
  })

  it('renders no completion action', () => {
    render(<PriorityAssigneePicker {...BASE} />)
    expect(screen.queryByTestId('task-options-complete')).not.toBeInTheDocument()
  })

  it('still renders priority', () => {
    render(<PriorityAssigneePicker {...BASE} />)
    expect(screen.getByLabelText('Priority 3')).toBeInTheDocument()
  })
})

describe('board state selector (task ffa5bbb5)', () => {
  const columns = boardColumnsFor(null)

  it('offers inbox, the default states, and done', () => {
    render(
      <PriorityAssigneePicker
        {...BASE}
        statusColumns={columns}
        selectedColumnId={INBOX_COLUMN_ID}
        onStatusSelect={vi.fn()}
      />,
    )
    for (const name of ['Inbox', 'Ready', 'Doing', 'Waiting', 'Done']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('offers a project custom state', () => {
    // "custom states if relevant" — the reason columns come from the module
    // rather than a hardcoded trio.
    const custom = boardColumnsFor({
      id: 'p1',
      customStates: [{ role: 'blocked', name: 'Blocked', order: 0 }],
    })
    render(
      <PriorityAssigneePicker
        {...BASE}
        statusColumns={custom}
        selectedColumnId="blocked"
        onStatusSelect={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Blocked' })).toBeInTheDocument()
  })

  it('marks the task current column as selected', () => {
    render(
      <PriorityAssigneePicker
        {...BASE}
        statusColumns={columns}
        selectedColumnId="doing"
        onStatusSelect={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Doing' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Ready' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('reports the column id, which is what resolveColumnMove takes', () => {
    const onStatusSelect = vi.fn()
    render(
      <PriorityAssigneePicker
        {...BASE}
        statusColumns={columns}
        selectedColumnId={INBOX_COLUMN_ID}
        onStatusSelect={onStatusSelect}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Waiting' }))
    expect(onStatusSelect).toHaveBeenCalledWith('waiting')

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onStatusSelect).toHaveBeenCalledWith(DONE_COLUMN_ID)
  })
})

describe('complete / mark incomplete (task ffa5bbb5)', () => {
  it('offers completion for an open task', () => {
    const onToggleComplete = vi.fn()
    render(
      <PriorityAssigneePicker {...BASE} completed={false} onToggleComplete={onToggleComplete} />,
    )
    fireEvent.click(screen.getByTestId('task-options-complete'))
    expect(onToggleComplete).toHaveBeenCalledTimes(1)
  })

  it('offers reopening for a completed task', () => {
    // The same control, relabelled — this is the only route to completion in
    // project mode, so it has to work in both directions.
    render(<PriorityAssigneePicker {...BASE} completed onToggleComplete={vi.fn()} />)
    expect(screen.getByTestId('task-options-complete')).toHaveTextContent(/incomplete|reopen/i)
  })
})
