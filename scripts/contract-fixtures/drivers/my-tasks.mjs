// Runs astrid-web's My Tasks scope over a case table and prints what it answers.
// Invoked by scripts/export-contract-fixtures.ts; not useful on its own.
//
// The rule is lib/my-tasks-scope.ts `myTasksShows`, which hooks/useFilterState.ts calls for the
// "my-tasks" list (AWTD-1262): the scope (assigned to me, or unassigned and created by me) and the
// two preferences that narrow it, filterPriority and filterAssignee. Completion and due date go
// through the same functions every list uses and are locked by filters.json, so they are not
// varied here — a completed task and a task on a list the reader has left are in the table only
// to show the scope does not read either.
//
// Disputed cases are routed to `disputed` by ./disputed.mjs. They are all D25: iOS's My Tasks is
// only what is assigned to the reader (reading the nested `assignee` when `assigneeId` is
// missing), is empty signed out, and never applies filterAssignee.
//
// Usage: node scripts/contract-fixtures/drivers/my-tasks.mjs <path-to-astrid-web>

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'
import { partition } from './disputed.mjs'

const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/my-tasks.mjs <path-to-astrid-web>')
  process.exit(2)
}

registerWebAliases(webRoot)

const { myTasksShows } = await import(pathToFileURL(join(webRoot, 'lib/my-tasks-scope.ts')).href)

const ME = 'u-me'
const OTHER = 'u-other'

const task = (id, fields) => ({
  id, completed: false, priority: 0, listIds: ['l-mine'], assignee: null, ...fields,
})

const TASKS = [
  task('assigned-to-me', { assigneeId: ME, assignee: { id: ME }, creatorId: OTHER, priority: 3 }),
  task('assigned-to-me-by-me', { assigneeId: ME, assignee: { id: ME }, creatorId: ME, priority: 1 }),
  task('created-by-me-unassigned', { assigneeId: null, creatorId: ME }),
  task('created-by-me-assigned-other', { assigneeId: OTHER, assignee: { id: OTHER }, creatorId: ME, priority: 2 }),
  task('someone-elses', { assigneeId: OTHER, assignee: { id: OTHER }, creatorId: OTHER, priority: 3 }),
  task('unassigned-not-mine', { assigneeId: null, creatorId: OTHER }),
  task('assigned-to-me-nested-only', { assignee: { id: ME }, creatorId: OTHER }),
  task('assigned-to-me-in-list-i-left', { assigneeId: ME, assignee: { id: ME }, creatorId: OTHER, listIds: ['l-left'] }),
  task('assigned-to-me-completed', { assigneeId: ME, assignee: { id: ME }, creatorId: OTHER, completed: true, priority: 2 }),
  task('created-by-me-unassigned-completed', { assigneeId: null, creatorId: ME, completed: true }),
]

const READERS = [ME, null]

const PRIORITIES = [
  ['any', []],
  ['high', [3]],
  ['none-or-low', [0, 1]],
]

const ASSIGNEES = [
  ['anyone', []],
  ['me', [ME]],
  ['unassigned', ['unassigned']],
  ['other', [OTHER]],
]

const cases = []
for (const reader of READERS) {
  for (const [priorityName, filterPriority] of PRIORITIES) {
    for (const [assigneeName, filterAssignee] of ASSIGNEES) {
      for (const t of TASKS) {
        cases.push({
          id: `my-tasks/${reader ?? 'signed-out'}/${priorityName}/${assigneeName}/${t.id}`,
          reader,
          filterPriority,
          filterAssignee,
          task: t.id,
          shown: myTasksShows(t, reader, { filterPriority, filterAssignee }),
        })
      }
    }
  }
}

const byId = Object.fromEntries(TASKS.map((t) => [t.id, t]))

const result = partition(cases, [
  {
    entry: 'D25',
    why: 'My Tasks scope: web also keeps unassigned tasks the reader created, reads assigneeId alone (not the nested assignee), and applies filterAssignee; iOS keeps only what is assigned to the reader, is empty signed out, and ignores filterAssignee',
    applies: (c) => c.reader === null || byId[c.task].assigneeId == null || c.filterAssignee.length > 0,
  },
])

process.stdout.write(JSON.stringify({
  generatedFrom: 'lib/my-tasks-scope.ts (myTasksShows, as hooks/useFilterState.ts calls it for "my-tasks")',
  // Cases name their task by id; this is the table they index.
  tasks: TASKS,
  ...result,
}))
