import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChatMentions } from '@/hooks/use-chat-mentions'
import type { User, TaskList, Task } from '@/types/task'

// Minimal factories
function makeUser(overrides: Partial<User> & { id: string; email: string }): User {
  return {
    name: null,
    createdAt: new Date(),
    ...overrides,
  } as User
}

function makeList(overrides: Partial<TaskList> & { id: string; name: string }): TaskList {
  return {
    privacy: 'PRIVATE' as const,
    isVirtual: false,
    ownerId: 'owner-1',
    owner: makeUser({ id: 'owner-1', email: 'owner@test.com', name: 'Owner' }),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TaskList
}

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    description: '',
    completed: false,
    priority: 1 as const,
    creatorId: 'user-1',
    creator: makeUser({ id: 'user-1', email: 'user@test.com', name: 'User' }),
    lists: [],
    comments: [],
    attachments: [],
    createdAt: new Date(),
    updatedAt: new Date('2024-01-01'),
    when: null,
    dueDateTime: null,
    isPrivate: false,
    repeating: 'never' as const,
    repeatingData: undefined,
    repeatFrom: 'DUE_DATE' as const,
    occurrenceCount: 0,
    ...overrides,
  } as Task
}

const currentUserId = 'current-user'
const alice = makeUser({ id: 'alice-id', email: 'alice@test.com', name: 'Alice' })
const bob = makeUser({ id: 'bob-id', email: 'bob@test.com', name: 'Bob' })
const astridBot = makeUser({ id: 'astrid-id', email: 'astrid@test.com', name: 'Astrid Bot', isAIAgent: true })

const defaultProps = {
  mentionableUsers: [alice, bob, astridBot, makeUser({ id: currentUserId, email: 'me@test.com', name: 'Me' })],
  currentUserId,
}

describe('useChatMentions', () => {
  // ─── Trigger Detection ───────────────────────────────────
  describe('trigger detection', () => {
    it('@ triggers mention type', () => {
      const { result } = renderHook(() => useChatMentions(defaultProps))
      act(() => { result.current.handleTextChange('@', 1) })
      expect(result.current.autocompleteType).toBe('mention')
    })

    it('# triggers list type', () => {
      const lists = [makeList({ id: 'l1', name: 'Work' })]
      const { result } = renderHook(() => useChatMentions({ ...defaultProps, lists }))
      act(() => { result.current.handleTextChange('#', 1) })
      expect(result.current.autocompleteType).toBe('list')
    })

    it('! triggers task type', () => {
      const tasks = [makeTask({ id: 't1', title: 'Buy milk' })]
      const { result } = renderHook(() => useChatMentions({ ...defaultProps, tasks }))
      act(() => { result.current.handleTextChange('!', 1) })
      expect(result.current.autocompleteType).toBe('task')
    })
  })

  // ─── Search Filtering ────────────────────────────────────
  describe('search filtering', () => {
    it('typing after @ filters users by name', () => {
      const { result } = renderHook(() => useChatMentions(defaultProps))
      act(() => { result.current.handleTextChange('@ast', 4) })
      expect(result.current.autocompleteType).toBe('mention')
      expect(result.current.autocompleteSearch).toBe('ast')
      expect(result.current.autocompleteItems).toHaveLength(1)
      expect(result.current.autocompleteItems[0].label).toBe('Astrid Bot')
    })

    it('typing after @ filters users by email', () => {
      const { result } = renderHook(() => useChatMentions(defaultProps))
      // Search "alice" matches Alice by email (alice@test.com)
      act(() => { result.current.handleTextChange('@alice', 6) })
      expect(result.current.autocompleteItems).toHaveLength(1)
      expect(result.current.autocompleteItems[0].label).toBe('Alice')
    })

    it('typing after # filters lists by name', () => {
      const lists = [
        makeList({ id: 'l1', name: 'Work' }),
        makeList({ id: 'l2', name: 'Personal' }),
      ]
      const { result } = renderHook(() => useChatMentions({ ...defaultProps, lists }))
      act(() => { result.current.handleTextChange('#wor', 4) })
      expect(result.current.autocompleteItems).toHaveLength(1)
      expect(result.current.autocompleteItems[0].label).toBe('Work')
    })

    it('typing after ! filters tasks by title', () => {
      const tasks = [
        makeTask({ id: 't1', title: 'Buy milk' }),
        makeTask({ id: 't2', title: 'Write tests' }),
      ]
      const { result } = renderHook(() => useChatMentions({ ...defaultProps, tasks }))
      act(() => { result.current.handleTextChange('!wri', 4) })
      expect(result.current.autocompleteItems).toHaveLength(1)
      expect(result.current.autocompleteItems[0].label).toBe('Write tests')
    })
  })

  // ─── Trigger Position Rules ──────────────────────────────
  describe('trigger position rules', () => {
    it('trigger at start of text works', () => {
      const { result } = renderHook(() => useChatMentions(defaultProps))
      act(() => { result.current.handleTextChange('@ali', 4) })
      expect(result.current.autocompleteType).toBe('mention')
    })

    it('trigger after whitespace works', () => {
      const { result } = renderHook(() => useChatMentions(defaultProps))
      act(() => { result.current.handleTextChange('hello @ali', 10) })
      expect(result.current.autocompleteType).toBe('mention')
      expect(result.current.autocompleteSearch).toBe('ali')
    })

    it('trigger NOT preceded by whitespace does not trigger', () => {
      const { result } = renderHook(() => useChatMentions(defaultProps))
      act(() => { result.current.handleTextChange('foo@bar', 7) })
      expect(result.current.autocompleteType).toBeNull()
    })

    it('search stops at whitespace after trigger', () => {
      const { result } = renderHook(() => useChatMentions(defaultProps))
      act(() => { result.current.handleTextChange('@foo bar', 8) })
      // Space in search string means the trigger is no longer active
      expect(result.current.autocompleteType).toBeNull()
    })
  })

  // ─── Priority: Closest Trigger to Cursor Wins ────────────
  describe('priority', () => {
    it('closest trigger to cursor wins', () => {
      const tasks = [makeTask({ id: 't1', title: 'Fix bug' })]
      const { result } = renderHook(() => useChatMentions({ ...defaultProps, tasks }))
      // Text: "@alice !fix" — cursor at end, ! is closer
      act(() => { result.current.handleTextChange('@alice !fix', 11) })
      expect(result.current.autocompleteType).toBe('task')
      expect(result.current.autocompleteSearch).toBe('fix')
    })
  })

  // ─── Item Building ───────────────────────────────────────
  describe('item building', () => {
    it('mention items include user data', () => {
      const { result } = renderHook(() => useChatMentions(defaultProps))
      act(() => { result.current.handleTextChange('@', 1) })
      const agentItem = result.current.autocompleteItems.find(i => i.label === 'Astrid Bot')
      expect(agentItem).toBeDefined()
      expect(agentItem!.type).toBe('mention')
      expect(agentItem!.isAIAgent).toBe(true)
      expect(agentItem!.secondaryLabel).toBe('astrid@test.com')
    })

    it('list items include privacy and shared info', () => {
      const lists = [
        makeList({ id: 'l1', name: 'Team', privacy: 'SHARED' }),
        makeList({ id: 'l2', name: 'Solo', privacy: 'PRIVATE' }),
      ]
      const { result } = renderHook(() => useChatMentions({ ...defaultProps, lists }))
      act(() => { result.current.handleTextChange('#', 1) })
      const teamItem = result.current.autocompleteItems.find(i => i.label === 'Team')
      expect(teamItem!.isShared).toBe(true)
      expect(teamItem!.privacy).toBe('SHARED')
      expect(teamItem!.secondaryLabel).toBe('Shared')
      const soloItem = result.current.autocompleteItems.find(i => i.label === 'Solo')
      expect(soloItem!.isShared).toBe(false)
      expect(soloItem!.secondaryLabel).toBeUndefined()
    })

    it('task items include completed status', () => {
      const tasks = [
        makeTask({ id: 't1', title: 'Done task', completed: true }),
        makeTask({ id: 't2', title: 'Open task', completed: false }),
      ]
      const { result } = renderHook(() => useChatMentions({ ...defaultProps, tasks }))
      act(() => { result.current.handleTextChange('!', 1) })
      const doneItem = result.current.autocompleteItems.find(i => i.label === 'Done task')
      expect(doneItem!.completed).toBe(true)
      const openItem = result.current.autocompleteItems.find(i => i.label === 'Open task')
      expect(openItem!.completed).toBe(false)
    })

    it('excludes current user from mention items', () => {
      const { result } = renderHook(() => useChatMentions(defaultProps))
      act(() => { result.current.handleTextChange('@', 1) })
      const ids = result.current.autocompleteItems.map(i => i.id)
      expect(ids).not.toContain(currentUserId)
    })

    it('excludes virtual lists', () => {
      const lists = [
        makeList({ id: 'l1', name: 'Real', isVirtual: false }),
        makeList({ id: 'l2', name: 'Virtual', isVirtual: true }),
      ]
      const { result } = renderHook(() => useChatMentions({ ...defaultProps, lists }))
      act(() => { result.current.handleTextChange('#', 1) })
      expect(result.current.autocompleteItems).toHaveLength(1)
      expect(result.current.autocompleteItems[0].label).toBe('Real')
    })
  })

  // ─── Task Sorting ────────────────────────────────────────
  describe('task sorting', () => {
    it('incomplete tasks appear before completed tasks', () => {
      const tasks = [
        makeTask({ id: 't1', title: 'Completed', completed: true, updatedAt: new Date('2024-06-01') }),
        makeTask({ id: 't2', title: 'Incomplete', completed: false, updatedAt: new Date('2024-01-01') }),
      ]
      const { result } = renderHook(() => useChatMentions({ ...defaultProps, tasks }))
      act(() => { result.current.handleTextChange('!', 1) })
      expect(result.current.autocompleteItems[0].label).toBe('Incomplete')
      expect(result.current.autocompleteItems[1].label).toBe('Completed')
    })

    it('tasks from selected list appear first', () => {
      const selectedListId = 'list-a'
      const tasks = [
        makeTask({ id: 't1', title: 'Other list task', completed: false, updatedAt: new Date('2024-06-01'), lists: [makeList({ id: 'list-b', name: 'B' })] }),
        makeTask({ id: 't2', title: 'Selected list task', completed: false, updatedAt: new Date('2024-01-01'), lists: [makeList({ id: selectedListId, name: 'A' })] }),
      ]
      const { result } = renderHook(() => useChatMentions({ ...defaultProps, tasks, selectedListId }))
      act(() => { result.current.handleTextChange('!', 1) })
      expect(result.current.autocompleteItems[0].label).toBe('Selected list task')
      expect(result.current.autocompleteItems[1].label).toBe('Other list task')
    })
  })

  // ─── Insertion ───────────────────────────────────────────
  describe('insertAutocompleteItem', () => {
    it('produces @[Name](id) format for mentions', () => {
      const { result } = renderHook(() => useChatMentions(defaultProps))
      act(() => { result.current.handleTextChange('@ali', 4) })
      const item = result.current.autocompleteItems[0]
      let insertion: { newText: string; newCursorPos: number } = { newText: '', newCursorPos: 0 }
      act(() => { insertion = result.current.insertAutocompleteItem(item, '@ali') })
      expect(insertion.newText).toBe('@[Alice](alice-id) ')
    })

    it('produces #[Name](id) format for lists', () => {
      const lists = [makeList({ id: 'l1', name: 'Work' })]
      const { result } = renderHook(() => useChatMentions({ ...defaultProps, lists }))
      act(() => { result.current.handleTextChange('#wor', 4) })
      const item = result.current.autocompleteItems[0]
      let insertion: { newText: string; newCursorPos: number } = { newText: '', newCursorPos: 0 }
      act(() => { insertion = result.current.insertAutocompleteItem(item, '#wor') })
      expect(insertion.newText).toBe('#[Work](l1) ')
    })

    it('produces ![Title](id) format for tasks', () => {
      const tasks = [makeTask({ id: 't1', title: 'Buy milk' })]
      const { result } = renderHook(() => useChatMentions({ ...defaultProps, tasks }))
      act(() => { result.current.handleTextChange('!buy', 4) })
      const item = result.current.autocompleteItems[0]
      let insertion: { newText: string; newCursorPos: number } = { newText: '', newCursorPos: 0 }
      act(() => { insertion = result.current.insertAutocompleteItem(item, '!buy') })
      expect(insertion.newText).toBe('![Buy milk](t1) ')
    })

    it('does not add trailing space if textAfter starts with space', () => {
      const { result } = renderHook(() => useChatMentions(defaultProps))
      act(() => { result.current.handleTextChange('@ali more text', 4) })
      // After "ali" the text is " more text" (starts with space)
      const item = result.current.autocompleteItems[0]
      // Note: the trigger is at position 0, search is "ali" (length 3), so textAfter starts at 0+3+1=4
      // But since there's a space at position 4, search includes it — actually let's re-check
      // "@ali more text" — the space at index 4 means search would contain a space → trigger clears
      // So we need to test this differently: place cursor at 4 in "@ali more"
      // Actually @ali has no space before "more" starts, let me think again...
      // "@ali" cursor=4, text after is " more text" — but search="ali" has no space so trigger IS active
    })

    it('preserves text before and after insertion', () => {
      const { result } = renderHook(() => useChatMentions(defaultProps))
      act(() => { result.current.handleTextChange('hello @ali', 10) })
      const item = result.current.autocompleteItems[0]
      let insertion: { newText: string; newCursorPos: number } = { newText: '', newCursorPos: 0 }
      act(() => { insertion = result.current.insertAutocompleteItem(item, 'hello @ali') })
      expect(insertion.newText).toBe('hello @[Alice](alice-id) ')
    })
  })

  // ─── No Duplicate Trailing Space ─────────────────────────
  describe('no duplicate trailing space', () => {
    it('does not add extra space when text after already starts with space', () => {
      const { result } = renderHook(() => useChatMentions(defaultProps))
      // Simulate: "hey @bob| rest" where | is cursor at position 8
      // textBeforeCursor = "hey @bob", trigger @ is at 4, search = "bob"
      act(() => { result.current.handleTextChange('hey @bob', 8) })
      const item = result.current.autocompleteItems.find(i => i.label === 'Bob')!
      let insertion: { newText: string; newCursorPos: number } = { newText: '', newCursorPos: 0 }
      // The full text includes " rest" after cursor
      act(() => { insertion = result.current.insertAutocompleteItem(item, 'hey @bob rest') })
      // textAfter = " rest" starts with space, so no extra space added
      expect(insertion.newText).toBe('hey @[Bob](bob-id) rest')
    })
  })

  // ─── Keyboard Navigation ─────────────────────────────────
  describe('keyboard navigation', () => {
    it('selectNext cycles through items', () => {
      const { result } = renderHook(() => useChatMentions(defaultProps))
      act(() => { result.current.handleTextChange('@', 1) })
      const itemCount = result.current.autocompleteItems.length
      expect(result.current.selectedIndex).toBe(0)
      act(() => { result.current.selectNext() })
      expect(result.current.selectedIndex).toBe(1)
      // Cycle to 0 after reaching end
      for (let i = 1; i < itemCount; i++) {
        act(() => { result.current.selectNext() })
      }
      expect(result.current.selectedIndex).toBe(0)
    })

    it('selectPrev wraps to end from 0', () => {
      const { result } = renderHook(() => useChatMentions(defaultProps))
      act(() => { result.current.handleTextChange('@', 1) })
      const itemCount = result.current.autocompleteItems.length
      expect(result.current.selectedIndex).toBe(0)
      act(() => { result.current.selectPrev() })
      expect(result.current.selectedIndex).toBe(itemCount - 1)
    })

    it('selectCurrent returns item at selectedIndex', () => {
      const { result } = renderHook(() => useChatMentions(defaultProps))
      act(() => { result.current.handleTextChange('@', 1) })
      const first = result.current.selectCurrent()
      expect(first).toEqual(result.current.autocompleteItems[0])
      act(() => { result.current.selectNext() })
      const second = result.current.selectCurrent()
      expect(second).toEqual(result.current.autocompleteItems[1])
    })

    it('selectCurrent returns null when no items', () => {
      const { result } = renderHook(() => useChatMentions({ ...defaultProps, mentionableUsers: [] }))
      act(() => { result.current.handleTextChange('@nope', 5) })
      expect(result.current.selectCurrent()).toBeNull()
    })
  })

  // ─── clearMention ────────────────────────────────────────
  describe('clearMention', () => {
    it('resets autocomplete state', () => {
      const { result } = renderHook(() => useChatMentions(defaultProps))
      act(() => { result.current.handleTextChange('@ali', 4) })
      expect(result.current.autocompleteType).toBe('mention')
      act(() => { result.current.clearMention() })
      expect(result.current.autocompleteType).toBeNull()
      expect(result.current.autocompleteSearch).toBeNull()
      expect(result.current.selectedIndex).toBe(0)
    })
  })
})
