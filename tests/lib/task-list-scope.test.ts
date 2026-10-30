import { describe, it, expect } from 'vitest'
import type { Task, TaskList } from '@/types/task'
import { scopeTasksToList, withoutList, listPath } from '@/lib/task-list-scope'

/** AWTD-1419 — what a list view starts from, and what deleting a list leaves. */

const task = (id: string, listIds: string[], extra: Partial<Task> = {}) =>
  ({ id, title: id, lists: listIds.map(l => ({ id: l, name: l })), ...extra }) as unknown as Task

const tasks = [task('a', ['mine']), task('b', ['public-1']), task('c', ['public-2']), task('d', ['mine', 'public-1'])]

describe('scopeTasksToList', () => {
  it("a list of your own shows its tasks", () => {
    const mine = { id: 'mine', name: 'Mine' } as TaskList
    expect(scopeTasksToList(tasks, 'mine', mine, 'u1').map(t => t.id)).toEqual(['a', 'd'])
  })

  it("a public list you don't belong to shows only its own tasks, not every public task you can read", () => {
    expect(scopeTasksToList(tasks, 'public-1', undefined, 'u1').map(t => t.id)).toEqual(['b', 'd'])
  })

  it('leaves system views other than My Tasks to the later filters', () => {
    expect(scopeTasksToList(tasks, 'today', undefined, 'u1')).toHaveLength(tasks.length)
  })
})

describe('withoutList', () => {
  it('drops the deleted list from the tasks that had it and keeps the rest of their lists', () => {
    const after = withoutList(tasks, 'public-1')
    expect(after.map(t => t.lists?.map(l => l.id))).toEqual([['mine'], [], ['public-2'], ['mine']])
  })

  it('returns untouched tasks as the same objects', () => {
    expect(withoutList(tasks, 'public-1')[0]).toBe(tasks[0])
  })
})

describe('listPath', () => {
  it('is / for My Tasks and /lists/<id> otherwise', () => {
    expect(listPath('my-tasks')).toBe('/')
    expect(listPath('abc')).toBe('/lists/abc')
  })
})
