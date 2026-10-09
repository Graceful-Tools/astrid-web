/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1025 — inside a list, a row does not repeat that list's chip: every row
 * would carry it, so it says nothing. The task's OTHER lists still show. The
 * row is told which list is being viewed (`currentListId`); list view and
 * board view both pass it.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Task } from '@/types/task'

vi.mock('@/contexts/feature-flag-context', () => ({
  useFeatureFlags: () => ({ isEnabled: () => true }),
}))

import { TaskRowContent } from '@/components/task-row-content'
import { listsShownOnRow } from '@/lib/list-flavors'

const task = {
  id: 't1',
  title: 'Row task',
  completed: false,
  priority: 0,
  repeating: 'never',
  lists: [
    { id: 'work', name: 'Work', color: '#f00', listType: 'regular' },
    { id: 'home', name: 'Home', color: '#0f0', listType: 'regular' },
    { id: 'urgent', name: 'Urgent', color: '#00f', listType: 'label' },
  ],
} as unknown as Task

describe('TaskRowContent hides the list being viewed (AWTD-1025)', () => {
  it('hides the current list and keeps the others', () => {
    render(<TaskRowContent task={task} currentListId="work" onToggleComplete={vi.fn()} onCopyPublic={vi.fn()} />)
    expect(screen.queryByText('Work')).toBeNull()
    expect(screen.getByText('Home')).toBeTruthy()
    expect(screen.getByText('Urgent')).toBeTruthy()
  })

  it('hides a label being viewed as a list, too', () => {
    render(<TaskRowContent task={task} currentListId="urgent" onToggleComplete={vi.fn()} onCopyPublic={vi.fn()} />)
    expect(screen.queryByText('Urgent')).toBeNull()
    expect(screen.getByText('Work')).toBeTruthy()
  })

  it('shows every list outside a list (no current list, or a virtual view)', () => {
    render(<TaskRowContent task={task} onToggleComplete={vi.fn()} onCopyPublic={vi.fn()} />)
    expect(screen.getByText('Work')).toBeTruthy()
    expect(screen.getByText('Home')).toBeTruthy()
  })
})

describe('listsShownOnRow (AWTD-1025)', () => {
  it('drops only the viewed list', () => {
    const lists = [{ id: 'a' }, { id: 'b' }]
    expect(listsShownOnRow(lists, 'a')).toEqual([{ id: 'b' }])
    expect(listsShownOnRow(lists, 'my-tasks')).toEqual(lists)
    expect(listsShownOnRow(lists, null)).toEqual(lists)
    expect(listsShownOnRow(undefined, 'a')).toEqual([])
  })
})
