// Runs astrid-web's editing-session machine through scripted sequences and prints what it
// answers. Invoked by scripts/export-contract-fixtures.ts; not useful on its own.
//
// Executed rather than parsed: the machine is four transitions and their interactions — a stale
// `end` after a hand-off, a re-`begin` of the open editor — and the only honest way to lock the
// interactions is to run the canonical implementation and record each step.
//
// Usage: node scripts/contract-fixtures/drivers/editing.mjs <path-to-astrid-web>

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'

const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/editing.mjs <path-to-astrid-web>')
  process.exit(2)
}

registerWebAliases(webRoot)

const { IDLE, begin, end, cancel, commitAll } = await import(
  pathToFileURL(join(webRoot, 'lib/editing-session.ts')).href
)

// Each sequence starts idle. A step is [operation, editor]; commitAll takes no editor.
const SEQUENCES = [
  { name: 'open one editor', steps: [['begin', 'title']] },
  { name: 're-opening the open editor is a no-op', steps: [['begin', 'title'], ['begin', 'title']] },
  { name: 'opening a second editor commits the first', steps: [['begin', 'title'], ['begin', 'description']] },
  { name: 'ending the open editor commits it', steps: [['begin', 'title'], ['end', 'title']] },
  { name: 'a stale end after a hand-off is ignored', steps: [['begin', 'title'], ['begin', 'lists'], ['end', 'title']] },
  { name: 'ending with nothing open does nothing', steps: [['end', 'title']] },
  { name: 'cancelling the open editor reverts it', steps: [['begin', 'title'], ['cancel', 'title']] },
  { name: 'a stale cancel is ignored', steps: [['begin', 'title'], ['begin', 'lists'], ['cancel', 'title']] },
  { name: 'navigating away commits whatever was open', steps: [['begin', 'description'], ['commitAll']] },
  { name: 'navigating away with nothing open commits nothing', steps: [['commitAll']] },
  { name: 'a full round: open, switch, switch back, end', steps: [['begin', 'title'], ['begin', 'assignee'], ['begin', 'title'], ['end', 'title']] },
]

const sequences = SEQUENCES.map(({ name, steps }) => {
  let state = IDLE
  const trace = []
  for (const [operation, editor] of steps) {
    const result =
      operation === 'begin' ? begin(state, editor)
      : operation === 'end' ? end(state, editor)
      : operation === 'cancel' ? cancel(state, editor)
      : commitAll(state)
    state = result.state
    trace.push({
      operation,
      editor: editor ?? null,
      active: result.state.activeEditor,
      commit: result.commit,
      cancel: result.cancel,
    })
  }
  return { name, steps: trace }
})

process.stdout.write(JSON.stringify({ generatedFrom: 'lib/editing-session.ts', sequences }))
