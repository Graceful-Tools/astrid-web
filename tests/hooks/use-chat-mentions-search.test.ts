/**
 * AWTD-1017 — the `!` task picker searches the server, the same search the
 * Waiting-on picker uses, so `!AWTD-12` finds a task whose title says nothing
 * of the sort, and tasks the client never loaded are findable. The stored
 * form stays `![Title](uuid)`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { Task } from '@/types/task'

const searchTasks = vi.fn()
vi.mock('@/lib/task-search-client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/task-search-client')>()),
  searchTasks: (query: string) => searchTasks(query),
}))

import { useChatMentions } from '@/hooks/use-chat-mentions'

const loaded = {
  id: 'local-1',
  title: 'Write the spec',
  identifier: 'AWTD-7',
  completed: false,
  lists: [],
  updatedAt: new Date('2026-01-01'),
} as unknown as Task

function setup() {
  return renderHook(() => useChatMentions({ mentionableUsers: [], currentUserId: 'me', tasks: [loaded] }))
}

beforeEach(() => {
  searchTasks.mockReset()
})

describe('! picker searches /api/v1/search (AWTD-1017)', () => {
  it('offers a server hit matched by identifier, and inserts it by uuid', async () => {
    searchTasks.mockResolvedValue([
      { id: 'remote-uuid', title: 'Fix the crash', identifier: 'AWTD-12', completed: false, lists: [{ id: 'l', name: 'Board' }] },
    ])
    const { result } = setup()
    act(() => { result.current.handleTextChange('!AWTD-12', 8) })

    await waitFor(() => expect(result.current.autocompleteItems.map(item => item.id)).toContain('remote-uuid'))
    expect(searchTasks).toHaveBeenCalledWith('AWTD-12')

    const item = result.current.autocompleteItems.find(candidate => candidate.id === 'remote-uuid')!
    expect(item.label).toBe('Fix the crash')
    expect(item.secondaryLabel).toContain('AWTD-12')

    let inserted = { newText: '' }
    act(() => { inserted = result.current.insertAutocompleteItem(item, '!AWTD-12') })
    expect(inserted.newText).toBe('![Fix the crash](remote-uuid) ')
  })

  it('matches loaded tasks by identifier without waiting for the server', () => {
    searchTasks.mockReturnValue(new Promise(() => {}))
    const { result } = setup()
    act(() => { result.current.handleTextChange('!awtd-7', 7) })
    expect(result.current.autocompleteItems.map(item => item.id)).toEqual(['local-1'])
  })

  it('does not search for a one-character query', () => {
    const { result } = setup()
    act(() => { result.current.handleTextChange('!w', 2) })
    expect(searchTasks).not.toHaveBeenCalled()
    expect(result.current.autocompleteItems.map(item => item.id)).toEqual(['local-1'])
  })

  it('does not list a task twice when local and server both find it', async () => {
    searchTasks.mockResolvedValue([{ id: 'local-1', title: 'Write the spec', identifier: 'AWTD-7', lists: [] }])
    const { result } = setup()
    act(() => { result.current.handleTextChange('!spec', 5) })
    await waitFor(() => expect(searchTasks).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(result.current.autocompleteItems.map(item => item.id)).toEqual(['local-1'])
  })
})
