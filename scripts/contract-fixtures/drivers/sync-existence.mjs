// Runs astrid-web's existence-check request parser and response shaper over fixed requests and
// prints what POST /api/v1/sync/existence answers. Invoked by scripts/export-contract-fixtures.ts;
// not useful on its own.
//
// The route is a query plus these two pure functions (lib/sync/v1-existence.ts, AWTD-1515), so the
// fixture is PRODUCED by them rather than described: a renamed key, a changed cap or a different
// 400 message fails `check:contract-fixtures` in the PR that made it. Which ids the caller can see
// is the database's answer and is given here as `visible`; what "visible" means is pinned by
// tests/api/v1-sync-existence.test.ts against the per-row GETs.
//
// Usage: node scripts/contract-fixtures/drivers/sync-existence.mjs <path-to-astrid-web>

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'

const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/sync-existence.mjs <path-to-astrid-web>')
  process.exit(2)
}

registerWebAliases(webRoot)

const { V1_EXISTENCE_MAX_IDS, parseExistenceRequest, shapeExistenceResponse } = await import(
  pathToFileURL(join(webRoot, 'lib/sync/v1-existence.ts')).href
)

const overCap = Array.from({ length: V1_EXISTENCE_MAX_IDS + 1 }, (_, i) => `task-${String(i).padStart(4, '0')}`)

const CASES = [
  {
    name: 'some gone',
    note: 'Missing ids come back in the order asked; a visible id is not listed.',
    request: { taskIds: ['task-visible', 'task-hidden', 'task-deleted'], listIds: ['list-shared', 'list-removed'] },
    visible: { taskIds: ['task-visible'], listIds: ['list-shared'] },
  },
  {
    name: 'one kind only',
    note: 'Either kind may be omitted; an omitted kind answers an empty array, never absent.',
    request: { listIds: ['list-removed'] },
    visible: { taskIds: [], listIds: [] },
  },
  {
    name: 'duplicates',
    note: 'A duplicated id is answered once.',
    request: { taskIds: ['task-gone', 'task-gone'] },
    visible: { taskIds: [], listIds: [] },
  },
  {
    name: 'over the cap',
    note: 'More than maxIds of one kind is a 400 whose error names the limit. Split the batch.',
    request: { taskIds: overCap },
    requestSummary: { taskIds: `${overCap.length} ids` },
    visible: { taskIds: [], listIds: [] },
  },
  {
    name: 'malformed',
    note: 'A kind that is not an array of non-empty strings is a 400.',
    request: { taskIds: 'task-visible' },
    visible: { taskIds: [], listIds: [] },
  },
]

const cases = CASES.map(({ name, note, request, requestSummary, visible }) => {
  const parsed = parseExistenceRequest(request)
  const response = parsed.ok
    ? {
        status: 200,
        body: shapeExistenceResponse({
          taskIds: parsed.taskIds,
          visibleTaskIds: visible.taskIds,
          listIds: parsed.listIds,
          visibleListIds: visible.listIds,
          authSource: 'oauth',
        }),
      }
    : { status: 400, body: { error: parsed.error } }
  return { name, note, request: requestSummary ?? request, visible, response }
})

process.stdout.write(JSON.stringify({
  $source: 'scripts/contract-fixtures/drivers/sync-existence.mjs — lib/sync/v1-existence.ts run over fixed requests',
  route: 'POST /api/v1/sync/existence',
  scopes: 'tasks:read for taskIds, lists:read for listIds (either admits the request)',
  missingMeans: 'the per-row GET /api/v1/tasks/:id or /api/v1/lists/:id would answer 403, 404 or 410',
  maxIds: V1_EXISTENCE_MAX_IDS,
  cases,
}))
