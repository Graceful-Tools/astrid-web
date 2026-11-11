import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import { ListItem } from '@/components/TaskManager/Sidebar/ListItem'

const baseList = {
  id: 'list-1',
  name: 'Inbox',
  description: '',
  color: '#000',
  privacy: 'PRIVATE' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  ownerId: 'owner-1',
  owner: { id: 'owner-1', email: 'owner@example.com', name: 'Owner', createdAt: new Date() },
  tasks: [],
  admins: [],
  members: [],
  listMembers: [],
  isFavorite: false
}

describe('Sidebar ListItem drag indicator', () => {
  const onClick = vi.fn()

  it('shows move indicator when list is active drop target', () => {
    render(
      <ListItem
        list={baseList}
        selectedListId="other"
        isMobile={false}
        taskCount={3}
        onClick={onClick}
        droppable
        isDragActive
        isDropTarget
        dropMode="move"
      />
    )

    const button = screen.getByRole('button')
    expect(button.className).toContain('bg-brand/15')
    expect(button.className).toContain('ring-brand')
  })

  it('shows add indicator when shift mode is active', () => {
    render(
      <ListItem
        list={baseList}
        selectedListId="other"
        isMobile={false}
        taskCount={3}
        onClick={onClick}
        droppable
        isDragActive
        isDropTarget
        dropMode="add"
      />
    )

    const button = screen.getByRole('button')
    expect(button.className).toContain('bg-brand/15')
    expect(button.className).toContain('ring-brand')
  })
})
