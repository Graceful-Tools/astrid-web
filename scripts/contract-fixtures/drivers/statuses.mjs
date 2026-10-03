// Runs astrid-web's board-status writers over a case matrix and prints the results as JSON.
// Invoked by scripts/export-contract-fixtures.ts; not useful on its own.
//
// A board's columns are `Project.customStates`, free-form JSON the web writes through four pure
// functions in lib/project-custom-states.ts: add, rename, reorder, remove. Each has rules that
// go wrong silently — which role a new column mints (`custom-<slug>`, suffixed on a clash), which
// names are refused (empty, too long, a built-in's, a duplicate), that a rename keeps the role so
// no task is orphaned, that only custom columns move or go. Retyping those into Rust from a reading
// of the TypeScript is the drift the fixtures exist to prevent, so they are RUN here and the
// answers recorded (task e5214fba).
//
// Usage: node scripts/contract-fixtures/drivers/statuses.mjs <path-to-astrid-web>

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'

const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/statuses.mjs <path-to-astrid-web>')
  process.exit(2)
}

registerWebAliases(webRoot)

const writers = await import(pathToFileURL(join(webRoot, 'lib/project-custom-states.ts')).href)
const {
  addCustomState,
  renameCustomState,
  renameBuiltinState,
  reorderCustomState,
  removeCustomState,
  MAX_STATUS_NAME_LENGTH,
} = writers
const status = await import(pathToFileURL(join(webRoot, 'lib/task-status.ts')).href)
const { isDefaultStatusRole } = status

// The web's route dispatches a rename by whether the role is a default; the client does the same,
// so the fixture records the combined answer.
const rename = (raw, role, name) =>
  isDefaultStatusRole(role) ? renameBuiltinState(raw, role, name) : renameCustomState(raw, role, name)

// Boards to start from: empty, one with a custom column and a renamed default, one whose stored
// JSON is partly junk, and one with roles that would collide on minting.
const BOARDS = {
  empty: undefined,
  configured: [
    { role: 'doing', name: 'In progress', order: 1 },
    { role: 'custom-review', name: 'Review', order: 5 },
    { role: 'custom-blocked', name: 'Blocked', order: 6 },
  ],
  junk: [
    { role: 'custom-review', name: 'Review', order: 0 },
    { role: 'custom-review', name: 'Duplicate', order: 1 },
    { role: '', name: 'No role', order: 2 },
    { role: 'nameless', order: 3 },
    'not an object',
  ],
  crowded: [
    { role: 'custom-qa', name: 'QA', order: 0 },
    { role: 'custom-qa-2', name: 'Q.A.', order: 1 },
  ],
}

const LONG = 'x'.repeat(MAX_STATUS_NAME_LENGTH + 1)

const CASES = [
  // add
  { op: 'add', board: 'empty', name: 'Review' },
  { op: 'add', board: 'empty', name: '  Needs   Info!  ' },
  { op: 'add', board: 'empty', name: '' },
  { op: 'add', board: 'empty', name: '   ' },
  { op: 'add', board: 'empty', name: LONG },
  { op: 'add', board: 'empty', name: 'ready' },
  { op: 'add', board: 'empty', name: 'Waiting' },
  { op: 'add', board: 'configured', name: 'review' },
  { op: 'add', board: 'configured', name: 'In progress' },
  { op: 'add', board: 'configured', name: 'Testing' },
  { op: 'add', board: 'crowded', name: 'QA?' },
  { op: 'add', board: 'crowded', name: '!!!' },
  { op: 'add', board: 'junk', name: 'Later' },
  // rename
  { op: 'rename', board: 'configured', role: 'custom-review', name: 'In review' },
  { op: 'rename', board: 'configured', role: 'custom-review', name: 'Review' },
  { op: 'rename', board: 'configured', role: 'custom-review', name: 'blocked' },
  { op: 'rename', board: 'configured', role: 'custom-review', name: 'Doing' },
  { op: 'rename', board: 'configured', role: 'custom-review', name: '' },
  { op: 'rename', board: 'configured', role: 'custom-nowhere', name: 'Gone' },
  { op: 'rename', board: 'empty', role: 'ready', name: 'Up next' },
  { op: 'rename', board: 'configured', role: 'doing', name: 'Doing' },
  { op: 'rename', board: 'configured', role: 'ready', name: 'Waiting' },
  { op: 'rename', board: 'configured', role: 'ready', name: 'Review' },
  { op: 'rename', board: 'empty', role: 'waiting', name: LONG },
  // reorder
  { op: 'reorder', board: 'configured', role: 'custom-blocked', direction: 'up' },
  { op: 'reorder', board: 'configured', role: 'custom-review', direction: 'up' },
  { op: 'reorder', board: 'configured', role: 'custom-review', direction: 'down' },
  { op: 'reorder', board: 'configured', role: 'custom-blocked', direction: 'down' },
  { op: 'reorder', board: 'configured', role: 'doing', direction: 'down' },
  { op: 'reorder', board: 'configured', role: 'custom-nowhere', direction: 'up' },
  // remove
  { op: 'remove', board: 'configured', role: 'custom-review' },
  { op: 'remove', board: 'configured', role: 'doing' },
  { op: 'remove', board: 'configured', role: 'custom-nowhere' },
  { op: 'remove', board: 'junk', role: 'custom-review' },
]

const run = (c) => {
  const raw = BOARDS[c.board]
  switch (c.op) {
    case 'add':
      return addCustomState(raw, c.name)
    case 'rename':
      return rename(raw, c.role, c.name)
    case 'reorder':
      return reorderCustomState(raw, c.role, c.direction)
    case 'remove':
      return removeCustomState(raw, c.role)
    default:
      throw new Error(`unknown op ${c.op}`)
  }
}

const cases = CASES.map((c) => {
  const result = run(c)
  return {
    ...c,
    result: 'error' in result
      ? { error: result.error, message: result.message }
      : { states: result.states, state: result.state },
  }
})

process.stdout.write(
  JSON.stringify({
    generatedFrom: 'lib/project-custom-states.ts',
    maxStatusNameLength: MAX_STATUS_NAME_LENGTH,
    boards: Object.fromEntries(Object.entries(BOARDS).map(([name, raw]) => [name, raw ?? null])),
    cases,
  }),
)
