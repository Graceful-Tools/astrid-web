/**
 * @vitest-environment jsdom
 */

/**
 * The occurrence chain row (AWTD-1219, spec §10.2).
 *
 * On a GitHub board a repeating task spawns a successor rather than rolling
 * forward, so an occurrence is one link in a chain. Without this row the series
 * reads as a pile of unrelated tasks.
 *
 * Pinned:
 *   - absent, not empty, on the ~100% of tasks that are not in a spawn series;
 *   - each link is independent, because `nextOccurrenceId` rides the DETAIL
 *     payload only — its absence means "not known here", never "no successor";
 *   - the links use the same `/?task=` form as a `!task` reference;
 *   - the copy comes from i18n, never hardcoded.
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({
    t: (key: string) =>
      ({
        'tasks.occurrence.label': 'Occurrence',
        'tasks.occurrence.previous': 'Previous occurrence',
        'tasks.occurrence.next': 'Next occurrence',
      })[key] ?? key,
  }),
}))

import { TaskDetailOccurrenceRow } from '@/components/task-detail/TaskDetailOccurrenceRow'
import type { Task } from '@/types/task'

const task = (over: Partial<Task> = {}) => ({ id: 't1', title: 'Water the plants', ...over }) as Task

describe('TaskDetailOccurrenceRow (AWTD-1219)', () => {
  it('renders nothing when the task is in no chain', () => {
    // Every task on a classic list takes this path, which is why it must be
    // absent rather than an empty row.
    const { container } = render(<TaskDetailOccurrenceRow task={task()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when both ids are explicitly null', () => {
    const { container } = render(
      <TaskDetailOccurrenceRow task={task({ previousOccurrenceId: null, nextOccurrenceId: null })} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('links to the previous occurrence alone', () => {
    // The newest occurrence in a series: it has a predecessor and no successor.
    render(<TaskDetailOccurrenceRow task={task({ previousOccurrenceId: 'older' })} />)

    expect(screen.getByRole('link', { name: 'Previous occurrence' })).toHaveAttribute(
      'href',
      '/?task=older',
    )
    expect(screen.queryByRole('link', { name: 'Next occurrence' })).not.toBeInTheDocument()
  })

  it('links to the next occurrence alone', () => {
    // The first occurrence, completed: a successor exists, nothing before it.
    render(<TaskDetailOccurrenceRow task={task({ nextOccurrenceId: 'newer' })} />)

    expect(screen.getByRole('link', { name: 'Next occurrence' })).toHaveAttribute('href', '/?task=newer')
    expect(screen.queryByRole('link', { name: 'Previous occurrence' })).not.toBeInTheDocument()
  })

  it('links both ways in the middle of a chain', () => {
    render(
      <TaskDetailOccurrenceRow task={task({ previousOccurrenceId: 'older', nextOccurrenceId: 'newer' })} />,
    )

    expect(screen.getByRole('link', { name: 'Previous occurrence' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Next occurrence' })).toBeInTheDocument()
  })

  it('escapes an id rather than pasting it into the href', () => {
    render(<TaskDetailOccurrenceRow task={task({ previousOccurrenceId: 'a b&c' })} />)

    expect(screen.getByRole('link', { name: 'Previous occurrence' })).toHaveAttribute(
      'href',
      '/?task=a%20b%26c',
    )
  })

  it('names the row for a screen reader', () => {
    render(<TaskDetailOccurrenceRow task={task({ previousOccurrenceId: 'older' })} />)
    expect(screen.getByLabelText('Occurrence')).toBeInTheDocument()
  })
})
