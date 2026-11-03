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

const { parseDecision, parseRating, isTradeoffGrid, chosenNumber, decisionReply, rowName, columnLetter, RATING_STYLE } = formats

/** A GFM table's body rows as cell text, enough for the cases here (no escaped pipes). */
function tableRows(markdown) {
  const lines = markdown.split('\n').filter(line => line.trim().startsWith('|'))
  return lines.slice(2).map(line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()))
}

const DECISIONS = [
  { name: 'canonical example', note: 'docs/DECISIONS.md', text: DECISION_EXAMPLE },
  {
    name: 'option label forms',
    note: 'A. / B) / C: / D with no punctuation, bullets or numbers. Numbered 1-4 in order.',
    text: '**Decision:** Pick one\n\n- **A.** dot\n* **B)** paren\n1. **C:** colon\n2. **D** bare',
  },
  {
    name: 'numbered options',
    note: '**1.** / **2)** / **3** work like letters (up to two digits); the marker is kept as `letter`.',
    text: '**Decision:** Pick one\n\n- **1.** Go\n- **2)** Wait\n- **3** Neither',
  },
  { name: 'three-digit marker', note: 'Not an option marker.', text: '**Decision:** Pick\n\n- **100.** a\n- **101.** b' },
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
    name: 'one-line code span',
    note: 'A ```code span``` on one line is not a fence (a backtick fence\'s info string has no backtick).',
    text: 'Use ```**Decision:**``` to ask.\n\n**Decision:** Pick\n\n- **A.** one\n- **B.** two',
  },
  {
    name: 'fence inside a list item',
    note: 'A fence can open after a list marker; what it holds is code.',
    text: '- Like this:\n- ```markdown\n  **Decision:** Pick\n\n  - **A.** one\n  - **B.** two\n  ```',
  },
  {
    name: 'options indented as code',
    note: 'A real heading whose options are an indented code block has no options.',
    text: '**Decision:** Pick\n\n    - **A.** one\n    - **B.** two',
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
  // The grid draws "<n>. <rowName>"; criteria are lettered A, B, C (AWTD-1533).
  rowNames: c.rows.map(row => rowName(row[0])),
}))

const ROW_MARKERS = ['A. Lisbon', '2) Cabin', 'C: Pizza', 'B', '12. Twelve', 'Pizza', 'I am here', 'A.Lisbon'].map(text => ({
  text,
  name: rowName(text),
}))

const COLUMN_LETTERS = [0, 1, 25, 26, 27, 51, 52, 701, 702].map(index => ({ index, letter: columnLetter(index) }))

// Against the canonical example's options (numbered 1-3) and a lettered A-C Decision.
const LETTERED = parseDecision('**Decision:** x\n\n- **A.** a\n- **B.** b\n- **C.** c').options
const REPLIES = [
  '1 — Lisbon', '2', '3.', '1) sure', '4', '0', '2nd thoughts', '10 minutes',
  'A — Lisbon', 'b', 'C.', 'A) sure', 'Lisbon please', 'AB', '  a, then b', '',
  'Béatrice doit vérifier', '2ème avis nécessaire',
].map(reply => ({
  reply,
  chosenNumbered: chosenNumber(reply, DECISIONS[0].parsed.options),
  chosenLettered: chosenNumber(reply, LETTERED),
}))

const ratings = Object.fromEntries(
  Object.entries(RATING_STYLE).map(([token, style]) => [token, { labelKey: style.labelKey, label: style.label, rank: style.rank }]),
)

console.log(
  JSON.stringify({
    generatedFrom: 'lib/comment-formats.ts (parseDecision, isTradeoffGrid, parseRating, chosenNumber, decisionReply, rowName, columnLetter)',
    ratings,
    decisions: DECISIONS,
    replyFormat: DECISIONS[0].parsed.options.map(option => decisionReply(option)),
    grids: GRIDS,
    replies: REPLIES,
    rowMarkers: ROW_MARKERS,
    columnLetters: COLUMN_LETTERS,
  }),
)
