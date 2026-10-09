// Runs astrid-web's search-query parser over a set of queries and prints what it answers.
// Invoked by scripts/export-contract-fixtures.ts; not useful on its own.
//
// Executed rather than parsed: the aliases (`p:3`, `due:late`, `is:cancelled`), the quoting rule
// and the identifier shape are each a small table, and a port that retyped them would drift one
// alias at a time. Running the canonical parser records every one.
//
// Usage: node scripts/contract-fixtures/drivers/search.mjs <path-to-astrid-web>

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'

const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/search.mjs <path-to-astrid-web>')
  process.exit(2)
}

registerWebAliases(webRoot)

const { parseSearchQuery, isEmptySearch, priorityToNumber } = await import(
  pathToFileURL(join(webRoot, 'lib/search-query-parser.ts')).href
)

const QUERIES = [
  '',
  '   ',
  'rollover',
  'buy oat milk',
  'assignee:me priority:high overdue rollover',
  'owner:@dana',
  'assignee:dana@example.test',
  'list:Work',
  'list:"Bugs and Polish" crash',
  'label:bug tag:polish',
  'priority:high p:3 p:urgent',
  'priority:none p:0 p:low p:1 p:med p:medium p:2',
  'priority:sky-high',
  'due:today',
  'due:overdue due:late',
  'due:week due:this-week',
  'due:month due:this-month',
  'due:none due:never',
  'due:someday',
  'is:open is:incomplete',
  'is:done is:complete is:completed',
  'is:canceled is:cancelled',
  'is:whatever',
  'is:',
  ':leading',
  'status:ready status:Doing',
  'status:none',
  'status:',
  'AST-142',
  'ast-142 and some words',
  'a-1',
  'toolong-1',
  'AST-142-extra',
  'hostname:foo',
  '"quoted words" and:not-a-key',
  'assignee:me list:Work label:bug priority:high due:week is:open status:ready text',
]

const queries = QUERIES.map(query => {
  const parsed = parseSearchQuery(query)
  return { query, parsed, isEmpty: isEmptySearch(parsed) }
})

process.stdout.write(
  JSON.stringify({
    generatedFrom: 'lib/search-query-parser.ts',
    priorityNumbers: Object.fromEntries(['none', 'low', 'medium', 'high'].map(p => [p, priorityToNumber(p)])),
    queries,
  }),
)
