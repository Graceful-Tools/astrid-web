// Runs astrid-web's decision-grid serialiser (lib/decision-grid.ts) over a fixed case set and prints
// what it reads and writes, so iOS, Android and Windows edit a decision's trade-off grid the way
// web does (ADEV-180). Invoked by scripts/export-contract-fixtures.ts; not useful on its own.
//
// Usage: node scripts/contract-fixtures/drivers/decision-grid.mjs <path-to-astrid-web>

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'

const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/decision-grid.mjs <path-to-astrid-web>')
  process.exit(2)
}

registerWebAliases(webRoot)

const lib = await import(pathToFileURL(join(webRoot, 'lib/decision-grid.ts')).href)
const { DECISION_EXAMPLE } = await import(pathToFileURL(join(webRoot, 'lib/decision-examples.ts')).href)
const { parseGrid, serializeGrid, replaceGrid, buildNewDecision, chosenOption, recordDecided } = lib

const SERIALISE = [
  {
    name: 'canonical example',
    note: 'The grid in docs/DECISIONS.md, read and written back.',
    markdown: DECISION_EXAMPLE,
  },
  {
    name: 'escaped pipes and empty cells',
    note: 'A pipe in a cell is written \\| and read back; an empty cell stays empty; the option column is renumbered 1, 2.',
    markdown: '| Pick | A \\| B | C |\n|---|---|---|\n| 7. one \\| two | ++ yes \\| no |  |\n| Z) Do nothing | -- never | ~ |',
  },
  {
    name: 'emoji ratings keep their token',
    note: 'The rating is written as it was read; only the rows are renumbered.',
    markdown: '| Option | Cost |\n|---|---|\n| A. Fast | 🟢 cheap |\n| B. Slow | 🔴 dear |',
  },
  { name: 'not a grid', note: 'An unrated cell: nothing to edit.', markdown: '| a | b |\n|---|---|\n| x | plain |' },
  {
    name: 'inside a fence',
    note: 'A table in code is an example, not the decision grid.',
    markdown: '```\n| a | b |\n|---|---|\n| x | + y |\n```',
  },
].map(c => {
  const found = parseGrid(c.markdown)
  return { ...c, grid: found ? found.grid : null, serialized: found ? serializeGrid(found.grid) : null }
})

const edited = parseGrid(DECISION_EXAMPLE).grid
edited.options[1].cells[0] = { rating: '++', text: 'cheapest by far' }
const EDIT = { name: 'edit one cell', note: 'Prose before and after the grid is untouched.', grid: edited, markdown: replaceGrid(DECISION_EXAMPLE, edited) }

const GOALS = {
  goals: [
    { id: 'g1', statement: 'Grow IRR', measure: 'IRR', target: '≥ 8%/yr', current: '6.1%' },
    { id: 'g2', statement: 'Keep risk low' },
  ],
  guardrails: [{ id: 'r1', statement: 'No more than 20% in one position', kind: 'enforced' }],
}
const NEW = [
  { name: 'goals and a guardrail', title: 'Which fund?', goalsAndGuardrails: GOALS },
  { name: 'no goals', title: '', goalsAndGuardrails: { goals: [], guardrails: [] } },
].map(c => ({ ...c, result: buildNewDecision({ title: c.title, goalsAndGuardrails: c.goalsAndGuardrails }) }))

const decided = NEW[0].result.description
const RECORD = [
  { name: 'open', replies: ['what about cost?'] },
  { name: 'chosen by reply', replies: ['2 — Option 2'] },
  { name: 'latest reply wins', replies: ['1', '3 — Do nothing'] },
].map(c => ({ ...c, chosen: chosenOption(decided, c.replies) }))
const recorded = recordDecided(decided, 3)
RECORD.push({ name: 'recorded on the task wins over replies', description: recorded, replies: ['1'], chosen: chosenOption(recorded, ['1']) })

console.log(
  JSON.stringify({
    generatedFrom: 'lib/decision-grid.ts (parseGrid, serializeGrid, replaceGrid, buildNewDecision, chosenOption, recordDecided)',
    serialise: SERIALISE,
    edit: EDIT,
    newDecisions: NEW,
    decidedDescription: decided,
    record: RECORD,
  }),
)
