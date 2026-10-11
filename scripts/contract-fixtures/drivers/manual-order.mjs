// Runs astrid-web's manual-order rules over a case table and prints what they answer.
// Invoked by scripts/export-contract-fixtures.ts; not useful on its own.
//
// Two halves:
//   - `sanitizeManualOrder` (lib/list-manual-order.ts): what the server stores when a client sends
//     an arrangement. Undisputed — every client reconciles the same way, and the core's
//     `manual_order::reconcile` runs it first for the offline redraw.
//   - the "manual" sort (lib/task-sort.ts, `sortTasksForList`): how a list set to manual draws.
//     Undisputed while every task is in the arrangement. A task the arrangement has never seen,
//     and a list with no arrangement yet, are D33: web puts those oldest first, iOS (and the core)
//     newest first.
//
// `requested` only ever holds strings here. Web also drops non-string entries from the request
// body; the core's input is already `[String]` (a decoder drops them), so there is nothing for a
// case to compare.
//
// Usage: node scripts/contract-fixtures/drivers/manual-order.mjs <path-to-astrid-web>

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'
import { partition } from './disputed.mjs'

const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/manual-order.mjs <path-to-astrid-web>')
  process.exit(2)
}

registerWebAliases(webRoot)

const { sanitizeManualOrder } = await import(pathToFileURL(join(webRoot, 'lib/list-manual-order.ts')).href)
const { sortTasksForList } = await import(pathToFileURL(join(webRoot, 'lib/task-sort.ts')).href)

const RECONCILE = [
  ['names-exactly-the-list', ['c', 'a', 'b'], ['a', 'b', 'c']],
  ['drops-unknown', ['gone', 'b', 'a'], ['a', 'b']],
  ['appends-unmentioned-in-creation-order', ['c'], ['a', 'b', 'c', 'd']],
  ['collapses-duplicates-to-first', ['b', 'a', 'b', 'a'], ['a', 'b']],
  ['empty-request', [], ['a', 'b', 'c']],
  ['empty-list', ['a', 'b'], []],
  ['all-unknown', ['x', 'y'], ['a', 'b']],
  ['every-id-twice-reversed', ['c', 'b', 'a', 'c', 'b', 'a'], ['a', 'b', 'c']],
  ['stale-and-partial', ['d', 'gone', 'b', 'd', 'also-gone'], ['a', 'b', 'c', 'd', 'e']],
  ['case-sensitive-ids', ['A', 'b'], ['a', 'b']],
  ['empty-string-id', ['', 'a'], ['a', '']],
]

const reconcile = RECONCILE.map(([id, requested, inListByCreation]) => ({
  id: `reconcile/${id}`,
  requested,
  inListByCreation,
  stored: sanitizeManualOrder(requested, inListByCreation),
}))

// Display: tasks with distinct creation times so no answer depends on sort stability.
const task = (id, createdAt) => ({ id, title: `Task ${id}`, completed: false, priority: 0, createdAt })
const TASKS = [
  task('a', '2026-01-01T09:00:00.000Z'),
  task('b', '2026-02-01T09:00:00.000Z'),
  task('c', '2026-03-01T09:00:00.000Z'),
  task('d', '2026-04-01T09:00:00.000Z'),
  task('e', '2026-05-01T09:00:00.000Z'),
]

const DISPLAY = [
  ['whole-arrangement', ['c', 'a', 'e', 'b', 'd']],
  ['whole-arrangement-reversed', ['e', 'd', 'c', 'b', 'a']],
  ['arrangement-names-a-task-that-left', ['d', 'gone', 'c', 'b', 'a', 'e']],
  ['unarranged-tasks', ['d', 'b']],
  ['nothing-arranged', []],
]

const display = DISPLAY.map(([id, manualOrder]) => ({
  id: `display/${id}`,
  tasks: TASKS,
  manualOrder,
  shown: sortTasksForList(TASKS, 'manual', manualOrder).map((t) => t.id),
}))

const everyId = new Set(TASKS.map((t) => t.id))
const result = partition([...reconcile, ...display], [
  {
    entry: 'D33',
    why: 'manual sort: tasks the arrangement does not name — web oldest first, iOS newest first',
    applies: (c) => c.id.startsWith('display/') && ![...everyId].every((id) => c.manualOrder.includes(id)),
  },
])

process.stdout.write(JSON.stringify({
  generatedFrom: 'lib/list-manual-order.ts (sanitizeManualOrder), lib/task-sort.ts (sortTasksForList "manual")',
  ...result,
}))
