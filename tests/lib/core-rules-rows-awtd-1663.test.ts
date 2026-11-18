/**
 * AWTD-1663: saved list views ordered by astrid-core's `rows` door (Jon, 2026-11-18: saved views
 * only). Core reorders; it never changes which tasks a view shows.
 *
 * The parity half drives the BROWSER package over the contract fixtures' task sets, every sort,
 * and holds core to the TypeScript's set of tasks: an order may differ (core breaks ties the way
 * iOS does, which is the point), a membership may not.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import * as glue from '@/packages/astrid-rules/web/astrid_rules_wasm.js'
import { coreOrderedIds, orderLikeCore, savedViewFor, type LiveFilters } from '@/lib/core-rules/rows-core'
import { resetBrowserCoreRulesForTests } from '@/lib/core-rules/browser'
import { sortTasksForList } from '@/lib/task-sort'
import { useFilterState } from '@/hooks/useFilterState'
import type { Task, TaskList } from '@/types/task'
import { buildTask, buildTaskList } from '../fixtures/domain'

vi.mock('@/hooks/useMyTasksPreferences', () => ({
  useMyTasksPreferences: () => ({
    filters: { priority: [], assignee: [], dueDate: 'all', completion: 'all', sortBy: 'auto', manualSortOrder: [] },
    setters: {},
    hasActiveFilters: false,
    clearAllFilters: vi.fn(),
    isLoading: false,
  }),
}))

const PACKAGE_DIR = path.join(process.cwd(), 'packages', 'astrid-rules')
glue.initSync({ module: readFileSync(path.join(PACKAGE_DIR, 'web', 'astrid_rules_wasm_bg.wasm')) })
const fixture = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'fixtures', 'filters.json'), 'utf8'))

const SORTS = ['auto', 'priority', 'dueDate', 'alphabetical', 'createdAt', 'completed', 'completedAt'] as const
const fixtureList = { id: 'L', name: 'L', ownerId: 'u1' } as unknown as TaskList
const sets = (['sortTasks', 'dueTasks', 'completionTasks'] as const).flatMap((set) =>
  SORTS.map((sortBy) => [set, sortBy] as const),
)

describe('AWTD-1663: core rows names the same tasks as the TypeScript for a saved view', () => {
  it('answers rows (it is in the browser rule set)', () => {
    expect(glue.kinds()).toContain('rows')
  })

  it.each(sets)('%s sorted by %s', (set, sortBy) => {
    const tasks = fixture[set].map((t: Record<string, unknown>) => ({
      title: String(t.id),
      createdAt: '2026-01-01T00:00:00Z',
      ...t,
      listIds: ['L'],
      lists: [{ id: 'L', name: 'L' }],
    })) as Task[]
    const ts = sortTasksForList(tasks, sortBy)
    const ids = coreOrderedIds({
      runJson: glue.runJson,
      view: { kind: 'list', list: fixtureList, completion: 'all', sortBy },
      candidates: tasks,
      lists: [fixtureList],
      currentUserId: 'u1',
      now: new Date(fixture.now),
    })
    expect(ids).not.toBeNull()
    expect([...ids!].sort()).toEqual(ts.map((t) => t.id).sort())
    expect(orderLikeCore(ts, ids).map((t) => t.id)).toEqual(ids)
  })
})

describe('AWTD-1663: orderLikeCore only ever reorders', () => {
  const a = { id: 'a' } as Task
  const b = { id: 'b' } as Task
  const c = { id: 'c' } as Task

  it('takes core order for the same set', () => {
    expect(orderLikeCore([a, b, c], ['c', 'a', 'b']).map((t) => t.id)).toEqual(['c', 'a', 'b'])
  })

  it('keeps the TypeScript list when core names a different set, a duplicate, or nothing', () => {
    expect(orderLikeCore([a, b, c], ['c', 'a'])).toEqual([a, b, c])
    expect(orderLikeCore([a, b, c], ['c', 'a', 'x'])).toEqual([a, b, c])
    expect(orderLikeCore([a, b, c], ['c', 'c', 'a'])).toEqual([a, b, c])
    expect(orderLikeCore([a, b, c], null)).toEqual([a, b, c])
  })
})

describe('AWTD-1663: which views are saved views', () => {
  const list = { id: 'L', name: 'L' } as TaskList
  const saved: LiveFilters = { search: '', completed: 'default', priority: [], assignee: [], dueDate: 'all', sortBy: 'auto' }
  const ask = (overrides: Partial<LiveFilters>, more: Partial<Parameters<typeof savedViewFor>[0]> = {}) =>
    savedViewFor({
      selectedListId: 'L',
      currentList: list,
      filters: { ...saved, ...overrides },
      savedCompletion: 'default',
      savedSortBy: 'auto',
      ...more,
    })

  it('a real list showing its saved completion and sort', () => {
    expect(ask({})).toMatchObject({ kind: 'list', completion: 'default', sortBy: 'auto' })
  })

  it('My Tasks, whose filters are its saved preferences', () => {
    expect(ask({ priority: [3] }, { selectedListId: 'my-tasks' })).toMatchObject({ kind: 'myTasks' })
  })

  it('not a live edit, a search, public, or a virtual list', () => {
    expect(ask({ sortBy: 'priority' })).toBeNull()
    expect(ask({ completed: 'all' })).toBeNull()
    expect(ask({ priority: [2] })).toBeNull()
    expect(ask({ assignee: ['u1'] })).toBeNull()
    expect(ask({ dueDate: 'today' })).toBeNull()
    expect(ask({ search: 'milk' })).toBeNull()
    expect(ask({}, { selectedListId: 'public' })).toBeNull()
    expect(ask({}, { currentList: { ...list, virtualListType: 'today' } as TaskList })).toBeNull()
  })
})

describe('AWTD-1663: applyFiltersToTasks asks the door only for a saved view', () => {
  afterEach(() => resetBrowserCoreRulesForTests())

  const list = buildTaskList({ id: 'list-1', name: 'List 1', ownerId: 'user-1' })
  const tasks = [
    buildTask({ id: 't1', title: 'B', priority: 1, createdAt: new Date('2026-01-02'), lists: [list] }),
    buildTask({ id: 't2', title: 'A', priority: 3, createdAt: new Date('2026-01-01'), lists: [list] }),
    buildTask({ id: 't3', title: 'C', priority: 0, createdAt: new Date('2026-01-03'), lists: [] }),
  ]
  const render = () => renderHook(() => useFilterState({ selectedListId: 'list-1', currentList: list }))

  it('keeps the TypeScript path while the door is not loaded', () => {
    const { result } = render()
    expect(result.current.applyFiltersToTasks(tasks, 'user-1', [list]).map((t) => t.id).sort()).toEqual(['t1', 't2'])
  })

  it('asks core rows for the saved view and shows the same tasks', () => {
    const runJson = vi.fn(glue.runJson)
    resetBrowserCoreRulesForTests({ runJson, answers: (k) => k === 'rows' })
    const { result } = render()
    const shown = result.current.applyFiltersToTasks(tasks, 'user-1', [list])
    expect(runJson).toHaveBeenCalledTimes(1)
    const request = JSON.parse(runJson.mock.calls[0][0])
    expect(request).toMatchObject({ kind: 'rows', idsOnly: true })
    expect(request.tasks.map((t: Task) => t.id).sort()).toEqual(['t1', 't2'])
    expect(shown.map((t) => t.id).sort()).toEqual(['t1', 't2'])
    // Core accepted web's task shape and answered — a refusal would also leave the same tasks.
    const reply = JSON.parse(runJson.mock.results[0].value as string)
    expect(reply.ok, JSON.stringify(reply.error)).toBe(true)
    expect(shown.map((t) => t.id)).toEqual(reply.value.ids)
  })

  it('does not ask once the filters are edited live, or during a search', () => {
    const runJson = vi.fn(glue.runJson)
    resetBrowserCoreRulesForTests({ runJson, answers: () => true })
    const { result } = render()
    act(() => result.current.setPriority([3]))
    result.current.applyFiltersToTasks(tasks, 'user-1', [list])
    act(() => {
      result.current.setPriority([])
      result.current.setSearch('A')
    })
    result.current.applyFiltersToTasks(tasks, 'user-1', [list])
    expect(runJson).not.toHaveBeenCalled()
  })
})
