// Runs astrid-web's empathy-art rules (lib/empathy-art/rules.ts, ADEV-142) over a case table and
// prints what they answer: the FNV-1a hash, the UTC day number, the list's metaphor for the day,
// and which state a board column maps to. Every client must pick the same frame.
// Invoked by scripts/export-contract-fixtures.ts; not useful on its own.
//
// Usage: node scripts/contract-fixtures/drivers/empathy-art.mjs <path-to-astrid-web>

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'

const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/empathy-art.mjs <path-to-astrid-web>')
  process.exit(2)
}

registerWebAliases(webRoot)

const {
  EMPATHY_METAPHORS,
  EMPATHY_STATES,
  fnv1a32,
  daysSinceEpochUTC,
  empathyMetaphorFor,
  empathyStateForColumn,
} = await import(pathToFileURL(join(webRoot, 'lib/empathy-art/rules.ts')).href)

// Known FNV-1a 32 vectors first, so a port can check its hash before the rotation.
const HASHES = ['', 'a', 'foobar', 'a623f322-4c3c-49b5-8a94-d2d9f00c82ba', '00000000-0000-0000-0000-000000000000']

const LISTS = [
  'a623f322-4c3c-49b5-8a94-d2d9f00c82ba',
  '15a7c7e6-43d2-4f76-82ff-032bf427985c',
  '00000000-0000-0000-0000-000000000000',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
]

// Day boundaries are UTC midnight: the last millisecond of one day and the first of the next.
const INSTANTS = [
  '1970-01-01T00:00:00.000Z',
  '2026-11-19T00:00:00.000Z',
  '2026-11-19T23:59:59.999Z',
  '2026-11-20T00:00:00.000Z',
  '2026-11-21T12:00:00.000Z',
  '2026-11-22T12:00:00.000Z',
  '2026-11-23T12:00:00.000Z',
]

const rotation = LISTS.flatMap((listId) =>
  INSTANTS.map((at) => ({
    listId,
    at,
    daysSinceEpochUTC: daysSinceEpochUTC(new Date(at)),
    metaphor: empathyMetaphorFor(listId, new Date(at)),
  })),
)

const COLUMNS = [
  { completed: false, statusRole: null },
  { completed: false, statusRole: 'ready' },
  { completed: false, statusRole: 'doing' },
  { completed: false, statusRole: 'waiting' },
  { completed: true, statusRole: null },
  { completed: true, statusRole: 'doing' },
  { completed: false, statusRole: 'custom' },
  { completed: false, statusRole: 'review' },
]

process.stdout.write(JSON.stringify({
  generatedFrom: 'lib/empathy-art/rules.ts',
  rule: 'metaphors[(fnv1a32(utf8(listId)) + floor(epochMs / 86400000)) % metaphors.length], summed without 32-bit wraparound',
  metaphors: EMPATHY_METAPHORS,
  states: EMPATHY_STATES,
  hashes: HASHES.map((text) => ({ text, fnv1a32: fnv1a32(text) })),
  rotation,
  columns: COLUMNS.map((column) => ({ ...column, state: empathyStateForColumn(column) })),
}))
