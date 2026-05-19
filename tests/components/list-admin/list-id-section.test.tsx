/**
 * @vitest-environment jsdom
 */

/**
 * Task 77b27e62 — Stage 13: extracting the List ID (OAuth/API integration)
 * row out of components/list-admin-settings.tsx into
 * components/list-admin/ListIdSection.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ListIdSection } from '@/components/list-admin/ListIdSection'
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

describe('ListIdSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the list id', () => {
    render(<ListIdSection list={makeList({ id: 'abc-123' })} />)
    expect(screen.getByText('List ID')).toBeInTheDocument()
    expect(screen.getByText('abc-123')).toBeInTheDocument()
  })

  it('copies the list id to the clipboard when the copy button is clicked', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.assign(navigator, { clipboard: { writeText } })

    render(<ListIdSection list={makeList({ id: 'abc-123' })} />)
    fireEvent.click(screen.getByTitle('Copy List ID'))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('abc-123'))
  })
})
