// Runs astrid-web's Decision and trade-off grid recognisers (lib/comment-formats.ts) over a fixed
// case set and prints what they read. Invoked by scripts/export-contract-fixtures.ts; not useful
// on its own.
//
// The canonical example (lib/decision-examples.ts) is the one docs/DECISIONS.md teaches, so web,
// iOS and Mac are held to the same text: iOS's AstridCore Decision.swift reads these cases and must
// agree, and a change to web's recogniser fails `check:contract-fixtures` in the PR that made it
// (AWTD-1531).
//
// Usage: node scripts/contract-fixtures/drivers/decisions.mjs <path-to-astrid-web>

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'

const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/decisions.mjs <path-to-astrid-web>')
  process.exit(2)
}

registerWebAliases(webRoot)

const formats = await import(pathToFileURL(join(webRoot, 'lib/comment-formats.ts')).href)
const { DECISION_EXAMPLE } = await import(pathToFileURL(join(webRoot, 'lib/decision-examples.ts')).href)

const { parseDecision, parseRating, isTradeoffGrid, chosenLetter, decisionReply, RATING_STYLE } = formats

/** A GFM table's body rows as cell text, enough for the cases here (no escaped pipes). */
function tableRows(markdown) {
  const lines = markdown.split('\n').filter(line => line.trim().startsWith('|'))
  return lines.slice(2).map(line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()))
}

const DECISIONS = [
  { name: 'canonical example', note: 'docs/DECISIONS.md', text: DECISION_EXAMPLE },
  {
    name: 'option label forms',
    note: 'A. / B) / C: / D with no punctuation, bullets or numbers.',
    text: '**Decision:** Pick one\n\n- **A.** dot\n* **B)** paren\n1. **C:** colon\n2. **D** bare',
  },
  { name: 'one option', note: 'Fewer than two options is not a Decision.', text: '**Decision:** Sure?\n\n- **A.** Yes' },
  { name: 'unlettered item', note: 'Every item must start with a bold letter.', text: '**Decision:** Pick\n\n- **A.** one\n- two' },
  {
    name: 'fenced example',
    note: 'A Decision inside a ``` or ~~~ fence is an example and stays code.',
    text: 'Write it like this:\n\n```markdown\n**Decision:** Pick\n\n- **A.** one\n- **B.** two\n```',
  },
  {
    name: 'indented example',
    note: 'Indented four spaces is code too.',
    text: 'Like this:\n\n    **Decision:** Pick\n\n    - **A.** one\n    - **B.** two',
  },
  {
    name: 'after a fenced example',
    note: 'A real Decision after a code example is still read; the example stays in `before`.',
    text: '```\n**Decision:** Pick\n\n- **A.** one\n- **B.** two\n```\n\n**Decision:** Really pick\n\n- **A.** this\n- **B.** that',
  },
].map(c => ({ ...c, parsed: parseDecision(c.text) }))

const GRIDS = [
  { name: 'canonical example', note: 'docs/DECISIONS.md', rows: tableRows(DECISION_EXAMPLE) },
  { name: 'emoji ratings', note: '🔴 / 🟡 / 🟢 read as poor / mixed / good.', rows: [['A', '🟢 quick', '🔴 risky'], ['B', '🟡 fine', '🟢 safe']] },
  { name: 'unrated cell', note: 'One body cell without a rating: not a grid.', rows: [['A', '+ fast', 'slow']] },
  { name: 'empty cells', note: 'An empty cell is allowed.', rows: [['A', '+ fast', ''], ['B', '', '- slow']] },
  { name: 'all bare dashes', note: 'A table of plain "-" placeholders is not a grid.', rows: [['A', '-', '-'], ['B', '-', '-']] },
].map(c => ({
  ...c,
  isGrid: isTradeoffGrid(c.rows),
  cells: c.rows.map(row => row.slice(1).map(cell => (cell.trim() === '' ? null : parseRating(cell)))),
}))

const REPLIES = ['A — Lisbon', 'b', 'C.', 'A) sure', 'Lisbon please', 'AB', '  a, then b', ''].map(reply => ({
  reply,
  chosen: chosenLetter(reply),
}))

const ratings = Object.fromEntries(
  Object.entries(RATING_STYLE).map(([token, style]) => [token, { labelKey: style.labelKey, label: style.label, rank: style.rank }]),
)

console.log(
  JSON.stringify({
    generatedFrom: 'lib/comment-formats.ts (parseDecision, isTradeoffGrid, parseRating, chosenLetter, decisionReply)',
    ratings,
    decisions: DECISIONS,
    replyFormat: DECISIONS[0].parsed.options.map(option => decisionReply(option)),
    grids: GRIDS,
    replies: REPLIES,
  }),
)
