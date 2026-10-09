// Runs astrid-web's project-board rules over a case matrix and prints the results as JSON.
// Invoked by scripts/export-contract-fixtures.ts; not useful on its own.
//
// Executed rather than parsed, for the same reason as the other two drivers: which column a card is
// in, and what a move writes, are branching rules whose precedence is the contract. Retyping them
// into Rust from a reading of the TypeScript is exactly the drift the fixtures exist to prevent —
// and this one has drifted before, twice, in web's own history (see the file's header).
//
// THE COLUMN ID IS A ROLE. Status began as membership in a `listType: 'status'` list and became a
// field on the task (`statusRole`); the rows were deleted. So a column id is a role, Inbox and Done
// are virtual and derived, and a client that puts a role in `listIds` gets its whole write rejected.
// Recording the move resolution here is what stops a client relearning that.
//
// Usage: node scripts/contract-fixtures/drivers/board.mjs <path-to-astrid-web>

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'

const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/board.mjs <path-to-astrid-web>')
  process.exit(2)
}

registerWebAliases(webRoot)

const board = await import(pathToFileURL(join(webRoot, 'lib/project-status.ts')).href)
const {
  getProjectBoardColumns,
  getTaskProjectColumnId,
  resolveProjectColumnCreate,
  resolveProjectColumnMove,
  getProjectDomainTasks,
  VIRTUAL_INBOX_COLUMN_ID,
  VIRTUAL_DONE_COLUMN_ID,
} = board

/** A task carrying only the fields a client holds. */
const task = ({ id, completed = false, statusRole = null, lists = [] }) => ({
  id,
  title: id,
  completed,
  statusRole,
  lists,
})

const list = (id, { projectId = null, listType = 'regular' } = {}) => ({
  id,
  name: id,
  projectId,
  listType,
})

// Two boards' worth of configuration: the defaults alone, and defaults plus a rename and a custom.
const CONFIGURATIONS = [
  { name: 'defaults only', customStates: undefined },
  {
    name: 'a renamed default and a custom column',
    customStates: [
      { role: 'doing', name: 'In progress', description: 'renamed default', order: 1 },
      { role: 'review', name: 'In review', description: 'a board of our own', order: 5 },
    ],
  },
  // Deliberately malformed: entries with no role or no name, a duplicate, and a non-array. A client
  // meeting a board configured by a newer web must still draw a usable board.
  {
    name: 'a configuration with unusable entries',
    customStates: [
      { role: 'review', name: 'In review', order: 0 },
      { role: 'review', name: 'Duplicate', order: 1 },
      { role: '', name: 'No role', order: 2 },
      { role: 'nameless', order: 3 },
      'not an object',
    ],
  },
]

const LISTS = [
  list('domain-1', { projectId: 'p1' }),
  list('domain-2', { projectId: 'p1' }),
  list('stale-status', { projectId: 'p1', listType: 'status' }),
  list('elsewhere', { projectId: 'p2' }),
  list('no-project'),
]

const CARDS = [
  task({ id: 'inbox-card', lists: [list('domain-1', { projectId: 'p1' })] }),
  task({ id: 'ready-card', statusRole: 'ready', lists: [list('domain-1', { projectId: 'p1' })] }),
  task({ id: 'custom-card', statusRole: 'review', lists: [list('domain-1', { projectId: 'p1' })] }),
  // A role no column has: reachable when a board's custom states have not loaded.
  task({ id: 'unknown-role-card', statusRole: 'nowhere', lists: [list('domain-1', { projectId: 'p1' })] }),
  task({ id: 'done-card', completed: true, statusRole: 'doing', lists: [list('domain-1', { projectId: 'p1' })] }),
  // Carrying a leftover status membership, which a move must strip.
  task({
    id: 'stale-membership-card',
    statusRole: 'ready',
    lists: [list('domain-1', { projectId: 'p1' }), list('stale-status', { projectId: 'p1', listType: 'status' })],
  }),
  // Only a status membership and no domain list: not a project task at all.
  task({
    id: 'orphan-card',
    lists: [list('stale-status', { projectId: 'p1', listType: 'status' })],
  }),
  task({ id: 'other-project-card', lists: [list('elsewhere', { projectId: 'p2' })] }),
]

const configurations = CONFIGURATIONS.map(({ name, customStates }) => {
  const columns = getProjectBoardColumns(customStates)
  return {
    name,
    customStates: customStates ?? null,
    columns,
    // Where each card lands, and what dragging it to each column would write.
    cards: CARDS.map((card) => ({
      id: card.id,
      completed: card.completed,
      statusRole: card.statusRole,
      listIds: card.lists.map((entry) => entry.id),
      columnId: getTaskProjectColumnId(card, columns),
      moves: columns.map((column) => ({
        columnId: column.id,
        result: resolveProjectColumnMove(card, column, LISTS),
      })),
    })),
    // What the add-task form sends for a new card in each column.
    creates: columns.map((column) => ({
      columnId: column.id,
      withDomainList: resolveProjectColumnCreate(column, 'domain-1'),
      withoutDomainList: resolveProjectColumnCreate(column, undefined),
    })),
  }
})

process.stdout.write(
  JSON.stringify({
    generatedFrom: 'lib/project-status.ts',
    virtualInboxColumnId: VIRTUAL_INBOX_COLUMN_ID,
    virtualDoneColumnId: VIRTUAL_DONE_COLUMN_ID,
    lists: LISTS,
    projectId: 'p1',
    // Which of the cards belong on p1's board at all.
    domainTaskIds: getProjectDomainTasks(CARDS, LISTS, 'p1').map((card) => card.id),
    configurations,
  }),
)
