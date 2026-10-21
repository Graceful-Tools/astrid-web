/**
 * Regression for AWTD-1308 (e8ac5301): "In my tasks Astrid web to-do not in
 * list of lists unless I search".
 *
 * Task detail's Lists editor offered the first 10 of `availableLists` when the
 * search box was empty, in whatever order the client happened to hold them.
 * GET /api/v1/lists has no ORDER BY on a full sync, so that order is Postgres
 * heap order — and an UPDATE writes a new tuple at the end of the heap. The
 * busiest list (Astrid Web To-do, ~1300 tasks, touched by every agent) is
 * therefore always LAST: index 11 of Jon's 12 on production, outside the cap,
 * reachable only by typing.
 *
 * The picker now orders lists itself (favorites by favoriteOrder, then by
 * name) and offers every selectable list; the dropdown scrolls.
 */

import { describe, it, expect } from 'vitest'
import { listPickerSuggestions, orderListsForPicker } from '@/lib/status-lists'
import type { TaskList } from '@/types/task'

const list = (id: string, name: string, extra: Partial<TaskList> = {}): TaskList =>
  ({ id, name, listType: 'regular', isVirtual: false, isFavorite: false, favoriteOrder: null, ...extra }) as TaskList

// Jon's production shape: 11 lists ahead of the busy board in heap order.
const others = Array.from({ length: 11 }, (_, i) => list(`l${i}`, `List ${String(i).padStart(2, '0')}`))
const busyBoard = list('a623f322', 'Astrid Web To-do', { isFavorite: true, favoriteOrder: 20 })
const heapOrder = [...others, busyBoard]

describe('listPickerSuggestions (AWTD-1308)', () => {
  it('offers the most-recently-updated list with an empty search, even when it is last in heap order', () => {
    const names = listPickerSuggestions(heapOrder, [], '').map(l => l.name)
    expect(names).toContain('Astrid Web To-do')
  })

  it('offers every selectable list when nothing is typed — no silent cap', () => {
    const many = Array.from({ length: 40 }, (_, i) => list(`m${i}`, `M ${i}`))
    expect(listPickerSuggestions(many, [], '')).toHaveLength(40)
  })

  it('still filters by the search term and excludes lists already selected', () => {
    const term = listPickerSuggestions(heapOrder, [], 'web').map(l => l.name)
    expect(term).toEqual(['Astrid Web To-do'])
    expect(listPickerSuggestions(heapOrder, [busyBoard], '').map(l => l.id)).not.toContain('a623f322')
  })

  it('excludes virtual lists and offers labels after destinations', () => {
    const saved = list('v', 'Today', { isVirtual: true })
    const label = list('lab', 'bug', { listType: 'label' })
    const ids = listPickerSuggestions([label, saved, ...heapOrder], [], '').map(l => l.id)
    expect(ids).not.toContain('v')
    expect(ids[ids.length - 1]).toBe('lab')
  })
})

describe('orderListsForPicker (AWTD-1308)', () => {
  it('puts favorites first by favoriteOrder, then the rest by name — independent of input order', () => {
    const a = list('a', 'Zeta', { isFavorite: true, favoriteOrder: 2 })
    const b = list('b', 'Alpha', { isFavorite: true, favoriteOrder: 1 })
    const c = list('c', 'beta')
    const d = list('d', 'Delta')
    expect(orderListsForPicker([d, a, c, b]).map(l => l.id)).toEqual(['b', 'a', 'c', 'd'])
    expect(orderListsForPicker([c, b, d, a]).map(l => l.id)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('does not mutate its input', () => {
    const input = [list('b', 'B'), list('a', 'A')]
    orderListsForPicker(input)
    expect(input.map(l => l.id)).toEqual(['b', 'a'])
  })
})

describe('filterListsForHashtag ordering (AWTD-1308)', () => {
  it('offers favorites first for a bare "#", not heap order', async () => {
    const { filterListsForHashtag } = await import('@/lib/quick-add')
    expect(filterListsForHashtag(heapOrder, '')[0].name).toBe('Astrid Web To-do')
  })
})
