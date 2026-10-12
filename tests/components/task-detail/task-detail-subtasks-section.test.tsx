/**
 * @vitest-environment jsdom
 */

/**
 * The subtasks section in task details (AWTD-1227).
 *
 * iPhone, iPad and Mac have shown "Sub tasks 0/2" with its children for a long
 * time. Web's detail pane showed nothing at all, though web nests the same
 * children in the LIST — so the data and the concept were both already here and
 * only this pane was missing them.
 *
 * Pinned:
 *   - absent, not an empty heading, on a task that has no children and cannot
 *     take one — which is almost every task in a read-only pane;
 *   - the count is done/total, not total alone;
 *   - completing a child calls the handler it was GIVEN, which is the list
 *     row's, so there is one completion path rather than two;
 *   - a failed add keeps what was typed, because losing it is worse than the
 *     failure;
 *   - read-only disables both the checkboxes and the add row.
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({
    t: (key: string, params?: Record<string, string>) =>
      key === 'tasks.subtasks'
        ? 'Subtasks'
        : key === 'tasks.subtaskSection.count'
          ? `${params?.done}/${params?.total}`
          : key === 'tasks.subtaskSection.add'
            ? 'Add a subtask'
            : key === 'tasks.subtaskSection.addPlaceholder'
              ? 'Add a subtask…'
              : key,
  }),
}))

import { TaskDetailSubtasksSection } from '@/components/task-detail/TaskDetailSubtasksSection'
import type { Task } from '@/types/task'

const child = (id: string, title: string, completed = false) => ({ id, title, completed }) as Task

describe('TaskDetailSubtasksSection (AWTD-1227)', () => {
  it('renders nothing with no children and no way to add one', () => {
    const { container } = render(<TaskDetailSubtasksSection subtasks={[]} readOnly />)
    expect(container).toBeEmptyDOMElement()
  })

  it('still offers the add row when there are no children yet', () => {
    render(<TaskDetailSubtasksSection subtasks={[]} onAdd={vi.fn()} />)
    expect(screen.getByLabelText('Add a subtask')).toBeInTheDocument()
  })

  it('counts the done ones, not just the total', () => {
    render(
      <TaskDetailSubtasksSection
        subtasks={[child('a', 'Order washer', true), child('b', 'Buy snake')]}
      />,
    )
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('completes a child through the handler it was given', async () => {
    // That handler is handleToggleTaskComplete — the list row's. A second
    // completion path here is a second place to get repeating tasks, streaks
    // and offline queuing wrong.
    const onToggleComplete = vi.fn()
    render(
      <TaskDetailSubtasksSection subtasks={[child('a', 'Order washer')]} onToggleComplete={onToggleComplete} />,
    )

    await userEvent.click(screen.getByRole('checkbox', { name: 'Order washer' }))
    expect(onToggleComplete).toHaveBeenCalledWith('a')
  })

  it('links a child so it can be opened', () => {
    render(<TaskDetailSubtasksSection subtasks={[child('a', 'Order washer')]} />)
    expect(screen.getByRole('link', { name: 'Order washer' })).toHaveAttribute('href', '/?task=a')
  })

  it('adds a subtask on Enter and clears the field', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined)
    render(<TaskDetailSubtasksSection subtasks={[]} onAdd={onAdd} />)

    const input = screen.getByLabelText('Add a subtask')
    await userEvent.type(input, 'Buy drain snake{Enter}')

    expect(onAdd).toHaveBeenCalledWith('Buy drain snake')
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('keeps what was typed when the add FAILS', async () => {
    // Clearing on failure loses the user's text and tells them nothing. The
    // field is cleared only after the call resolves.
    const onAdd = vi.fn().mockRejectedValue(new Error('offline'))
    render(<TaskDetailSubtasksSection subtasks={[]} onAdd={onAdd} />)

    const input = screen.getByLabelText('Add a subtask')
    await userEvent.type(input, 'Buy drain snake{Enter}')

    await waitFor(() => expect(onAdd).toHaveBeenCalled())
    // And the rejection does not escape the handler: an unhandled promise from
    // an onKeyDown is a console error in dev and nothing at all in production.
    expect(input).toHaveValue('Buy drain snake')
  })

  it('does not add an empty or whitespace title', async () => {
    const onAdd = vi.fn()
    render(<TaskDetailSubtasksSection subtasks={[]} onAdd={onAdd} />)

    await userEvent.type(screen.getByLabelText('Add a subtask'), '   {Enter}')
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('read-only shows the children but offers no way to change them', () => {
    render(
      <TaskDetailSubtasksSection
        subtasks={[child('a', 'Order washer')]}
        onToggleComplete={vi.fn()}
        onAdd={vi.fn()}
        readOnly
      />,
    )

    expect(screen.getByRole('checkbox', { name: 'Order washer' })).toBeDisabled()
    expect(screen.queryByLabelText('Add a subtask')).not.toBeInTheDocument()
  })
})
