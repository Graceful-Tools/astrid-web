/**
 * @vitest-environment jsdom
 */

/**
 * Task 77b27e62 — Stage 13: extracting the Delete List feature out of
 * components/list-admin-settings.tsx into
 * components/list-admin/DeleteListSection.tsx.
 *
 * Pins the extracted component: gating on canEditSettings, the
 * confirmation modal open/close, and the onDelete callback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DeleteListSection } from '@/components/list-admin/DeleteListSection'
import type { TaskList } from '@/types/task'

function makeList(overrides: Partial<TaskList> = {}): TaskList {
  return {
    id: 'list-1',
    name: 'Test List',
    color: '#3b82f6',
    ownerId: 'user-1',
    privacy: 'PRIVATE',
    createdAt: new Date(),
    updatedAt: new Date(),
    members: [],
    admins: [],
    tasks: [],
    ...overrides,
  } as TaskList
}

describe('DeleteListSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when the caller cannot edit settings', () => {
    const { container } = render(
      <DeleteListSection list={makeList()} canEditSettings={false} onDelete={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the Delete List button for an editor', () => {
    render(<DeleteListSection list={makeList()} canEditSettings={true} onDelete={vi.fn()} />)
    expect(screen.getByText('Delete List')).toBeInTheDocument()
  })

  it('opens the confirmation modal naming the list when Delete List is clicked', () => {
    render(
      <DeleteListSection
        list={makeList({ name: 'Groceries' })}
        canEditSettings={true}
        onDelete={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Delete List'))
    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument()
    expect(screen.getByText(/Groceries/)).toBeInTheDocument()
  })

  it('closes the modal without deleting when "Don\'t Delete" is clicked', () => {
    const onDelete = vi.fn()
    render(<DeleteListSection list={makeList()} canEditSettings={true} onDelete={onDelete} />)

    fireEvent.click(screen.getByText('Delete List'))
    fireEvent.click(screen.getByText("Don't Delete"))

    expect(screen.queryByText(/Are you sure you want to delete/)).not.toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('calls onDelete with the list id and closes when Delete is confirmed', () => {
    const onDelete = vi.fn()
    render(
      <DeleteListSection
        list={makeList({ id: 'list-99' })}
        canEditSettings={true}
        onDelete={onDelete}
      />
    )

    fireEvent.click(screen.getByText('Delete List'))
    fireEvent.click(screen.getByText('Delete'))

    expect(onDelete).toHaveBeenCalledWith('list-99')
    expect(screen.queryByText(/Are you sure you want to delete/)).not.toBeInTheDocument()
  })
})
