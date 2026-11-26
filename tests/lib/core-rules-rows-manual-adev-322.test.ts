/**
 * ADEV-322: a manual-sorted saved list ordered by core's `rows` door must follow the manual order
 * the web hands it, as the TypeScript does.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as glue from '@/packages/astrid-rules/web/astrid_rules_wasm.js'
import { coreOrderedIds } from '@/lib/core-rules/rows-core'
import { sortTasksForList } from '@/lib/task-sort'
import type { Task, TaskList } from '@/types/task'

glue.initSync({ module: readFileSync(path.join(process.cwd(), 'packages', 'astrid-rules', 'web', 'astrid_rules_wasm_bg.wasm')) })

const list = { id: 'L', name: 'L', ownerId: 'u1' } as unknown as TaskList
const task = (id: string, createdAt: string) =>
  ({ id, title: id, createdAt, completed: false, priority: 0, listIds: ['L'], lists: [{ id: 'L', name: 'L' }] }) as unknown as Task

describe('ADEV-322: core rows honours the manual order', () => {
  it.each([
    [['c', 'a', 'b']],
    [['b', 'c', 'a']],
  ])('order %j', (manualOrder) => {
    const tasks = [task('a', '2026-01-01T00:00:01Z'), task('b', '2026-01-01T00:00:02Z'), task('c', '2026-01-01T00:00:03Z')]
    const ts = sortTasksForList(tasks, 'manual', manualOrder).map((t) => t.id)
    expect(ts).toEqual(manualOrder)
    const ids = coreOrderedIds({
      runJson: glue.runJson,
      view: { kind: 'list', list, completion: 'all', sortBy: 'manual', manualOrder, filters: { filterPriority: null, filterAssignee: null, filterDueDate: null } },
      candidates: tasks,
      lists: [list],
      currentUserId: 'u1',
      now: new Date('2026-06-01T00:00:00Z'),
    })
    expect(ids).toEqual(manualOrder)
  })
})
