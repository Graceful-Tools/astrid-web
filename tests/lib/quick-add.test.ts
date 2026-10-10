/**
 * Task f699462a: 2- and 3-column keep the add-task control ABOVE the list, but
 * render the SAME control the 1-column view pins to the bottom — one component,
 * two placements. The pieces that decide what that shared control looks like in
 * a given placement live here as pure functions so both the component and this
 * suite can agree on them without a DOM.
 *
 * The hashtag helpers are the autocomplete that used to live inside
 * enhanced-task-creation.tsx. That component is retired by this task, so the
 * behaviour moved here rather than being dropped on the floor.
 */
import { describe, it, expect } from 'vitest'
import type { TaskList } from '@/types/task'
import {
  ADD_TASK_LABEL_MIN_WIDTH,
  shouldShowAddTaskLabel,
  findHashtagQuery,
  filterListsForHashtag,
  applyHashtagSelection,
  quickAddPlaceholder,
} from '@/lib/quick-add'

const list = (name: string, extra: Partial<TaskList> = {}): TaskList =>
  ({ id: name, name, ...extra }) as TaskList

describe('shouldShowAddTaskLabel (task f699462a)', () => {
  it('labels the button when an inline column is wide enough for the words', () => {
    expect(shouldShowAddTaskLabel('inline', ADD_TASK_LABEL_MIN_WIDTH)).toBe(true)
    expect(shouldShowAddTaskLabel('inline', ADD_TASK_LABEL_MIN_WIDTH + 200)).toBe(true)
  })

  it('falls back to the icon-only button in a narrow column', () => {
    expect(shouldShowAddTaskLabel('inline', ADD_TASK_LABEL_MIN_WIDTH - 1)).toBe(false)
  })

  it('never labels the fixed-bottom placement, however wide the phone', () => {
    // The 1-column bar is a compact sheet; a word next to the plus would push
    // the textarea into a sliver on exactly the layout with the least room.
    expect(shouldShowAddTaskLabel('fixed-bottom', 1200)).toBe(false)
  })

  it('stays icon-only until a width has actually been measured', () => {
    // First paint has no measurement. Guessing "wide" there makes the label
    // flash away on the very next frame in a narrow column.
    expect(shouldShowAddTaskLabel('inline', null)).toBe(false)
  })
})

describe('hashtag autocomplete helpers (task f699462a)', () => {
  it('reads the hashtag being typed at the caret', () => {
    expect(findHashtagQuery('buy milk #gro')).toEqual({ query: 'gro', start: 9 })
  })

  it('treats a bare # as an empty query so every list is offered', () => {
    expect(findHashtagQuery('#')).toEqual({ query: '', start: 0 })
  })

  it('is not triggered by a hashtag the user has finished typing', () => {
    expect(findHashtagQuery('#groceries buy milk')).toBeNull()
  })

  it('matches lists by name, and by their dashed and underscored forms', () => {
    const lists = [list('Astrid Web To-do'), list('Groceries')]
    expect(filterListsForHashtag(lists, 'web-to').map(l => l.name)).toEqual(['Astrid Web To-do'])
    expect(filterListsForHashtag(lists, 'web_to').map(l => l.name)).toEqual(['Astrid Web To-do'])
    expect(filterListsForHashtag(lists, 'groc').map(l => l.name)).toEqual(['Groceries'])
  })

  it('never offers a virtual list, which cannot hold a task', () => {
    const lists = [list('Today', { isVirtual: true }), list('Todo list')]
    expect(filterListsForHashtag(lists, 'tod').map(l => l.name)).toEqual(['Todo list'])
  })

  it('caps the dropdown so it cannot cover the list behind it', () => {
    const lists = Array.from({ length: 12 }, (_, i) => list(`List ${i}`))
    expect(filterListsForHashtag(lists, 'list')).toHaveLength(5)
  })

  it('replaces the typed fragment with the dashed list tag and a trailing space', () => {
    expect(applyHashtagSelection('buy milk #gro', 'Groceries')).toBe('buy milk #groceries ')
    expect(applyHashtagSelection('#web', 'Astrid Web To-do')).toBe('#astrid-web-to-do ')
  })

  it('leaves text alone when there is no hashtag to replace', () => {
    expect(applyHashtagSelection('buy milk', 'Groceries')).toBe('buy milk')
  })
})

describe('quickAddPlaceholder — one prompt everywhere (AWTD-1164)', () => {
  // It used to vary by layout — "Add task to Astrid Web To-do..." in 3-column,
  // "Add task..." in 2-column — which was longer, inconsistent, and logic
  // nobody else shared. Every placement and layout now says the same thing.
  it.each([
    { placement: 'inline', layoutType: '3-column', listName: 'Groceries' },
    { placement: 'inline', layoutType: '3-column', listName: 'My Tasks' },
    { placement: 'inline', layoutType: '2-column', listName: 'Groceries' },
    { placement: 'inline', layoutType: '1-column' },
    { placement: 'fixed-bottom', listName: 'Groceries' },
  ] as const)('%j → tasks.addTaskPlaceholder', args => {
    expect(quickAddPlaceholder(args as never)).toEqual({ key: 'tasks.addTaskPlaceholder' })
  })

  it('reads "Add a task..." in English', async () => {
    const en = (await import('@/lib/i18n/locales/en.json')).default as unknown as { tasks: Record<string, string> }
    expect(en.tasks.addTaskPlaceholder).toBe('Add a task...')
  })
})
