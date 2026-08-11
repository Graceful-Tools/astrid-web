import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ListSortAndFilters } from '@/components/list-sort-and-filters'
import type { TaskList, User } from '@/types/task'

/**
 * Task dce843a1 — the per-list "Show subtasks" toggle lives in the
 * Sort & Filters tab of list settings.
 *
 * It sits there rather than in Admin Settings because it decides what the
 * list VIEW renders, which is what everything else on that tab does. It is
 * still gated on canEditSettings: the API accepts showSubtasks only from an
 * owner/admin, so offering it to a plain member would be a control whose
 * save comes back 403.
 */

const currentUser = {
  id: 'u-1',
  email: 'u@example.com',
  name: 'U',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
} as unknown as User

function makeList(overrides: Partial<TaskList> = {}): TaskList {
  return {
    id: 'list-1',
    name: 'Test',
    privacy: 'PRIVATE',
    owner: currentUser,
    ownerId: 'u-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as unknown as TaskList
}

function renderPanel(list: TaskList, onUpdate = vi.fn(), canEditSettings = true) {
  const utils = render(
    <ListSortAndFilters
      list={list}
      currentUser={currentUser}
      onUpdate={onUpdate}
      canEditSettings={canEditSettings}
    />,
  )
  return { ...utils, onUpdate }
}

describe('ListSortAndFilters — Show subtasks toggle', () => {
  it('renders in the sort/filter panel for someone who can edit the list', () => {
    const { getByTestId } = renderPanel(makeList())
    expect(getByTestId('show-subtasks-row')).toBeTruthy()
    expect(getByTestId('show-subtasks-toggle')).toBeTruthy()
  })

  it('is ON for a list that predates the column', () => {
    // Absent must read as SHOW, or every existing list looks deliberately
    // switched off the moment this ships.
    const { getByTestId } = renderPanel(makeList({ showSubtasks: undefined }))
    expect(getByTestId('show-subtasks-toggle').getAttribute('data-state')).toBe('checked')
  })

  it('is OFF for a list that opted out', () => {
    const { getByTestId } = renderPanel(makeList({ showSubtasks: false }))
    expect(getByTestId('show-subtasks-toggle').getAttribute('data-state')).toBe('unchecked')
  })

  it('sends a real boolean up, which is what the API requires to write it', () => {
    const { getByTestId, onUpdate } = renderPanel(makeList({ showSubtasks: true }))
    fireEvent.click(getByTestId('show-subtasks-toggle'))
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0][0].showSubtasks).toBe(false)
  })

  it('is hidden from a member who cannot edit list settings', () => {
    const { queryByTestId } = renderPanel(makeList(), vi.fn(), false)
    expect(queryByTestId('show-subtasks-row')).toBeNull()
  })
})
