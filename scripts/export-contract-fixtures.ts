#!/usr/bin/env tsx
/**
 * Derive the cross-platform contract fixtures from this repo's canonical sources (AWTD-1031).
 *
 * The JSON under contracts/fixtures/ is what astrid-core's Rust tests compile in, and it is
 * generated — never hand-edited. A rule that is retyped is a rule that drifts, which is the exact
 * failure this whole mechanism exists to prevent.
 *
 * Usage:  npm run export:contract-fixtures          # write the fixtures
 *         npm run check:contract-fixtures           # exit 1 if any is stale (predeploy runs this)
 *
 * This used to live in the consumer, as astrid-core `contracts/export-from-web.mjs` (and before
 * that in astrid-windows). Owning it here means a change to a shared rule fails `--check` in the
 * PR that made it, rather than as a red build in another repo afterwards. The output format did
 * not change in the move; astrid-core reads these files by name and key.
 *
 * Two kinds of export. Some contracts are TABLES, read out of the source here. The rest are
 * ARITHMETIC, and the only honest way to lock those is to RUN the canonical implementation and
 * record what it returns — that is what scripts/contract-fixtures/drivers/*.mjs do, each in its
 * own `node` process (see drivers/alias-loader.mjs for the `@/` alias and the three stubs).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const webRoot = join(__dirname, '..')
const driversDir = join(__dirname, 'contract-fixtures', 'drivers')
const fixturesDir = join(webRoot, 'contracts', 'fixtures')
const check = process.argv.includes('--check')

// The drivers import .ts straight from the checkout, with Node's own type stripping, and resolve
// `@/` through a synchronous `registerHooks` hook. Node 20 has neither; without this the failure
// is a resolve error from inside a driver that names nothing useful.
if (typeof registerHooks !== 'function') {
  console.error(`export-contract-fixtures needs Node >= 22.18 (running ${process.version})`)
  process.exit(2)
}

const read = (rel: string) => readFileSync(join(webRoot, rel), 'utf8')

// Display keys in the KEYBOARD_SHORTCUTS table vs the KeyboardEvent.key names the switch matches.
const EVENT_KEY: Record<string, string> = { '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown' }

function exportShortcuts() {
  const src = read('hooks/useKeyboardShortcuts.ts')

  const tableMatch = src.match(/export const KEYBOARD_SHORTCUTS = \[([\s\S]*?)\n\] as const/)
  if (!tableMatch) throw new Error('KEYBOARD_SHORTCUTS table not found in useKeyboardShortcuts.ts')

  const rows: { key: string; description: string; action: string; param: number | null }[] = []
  const rowRe = /\{\s*key:\s*"([^"]+)",\s*description:\s*"([^"]*)",\s*action:\s*"([^"]+)"(?:,\s*param:\s*(\d+))?\s*\}/g
  for (const m of tableMatch[1].matchAll(rowRe)) {
    rows.push({ key: m[1], description: m[2], action: m[3], param: m[4] === undefined ? null : Number(m[4]) })
  }
  if (rows.length === 0) throw new Error('KEYBOARD_SHORTCUTS parsed to zero rows — the table shape changed')

  // The selection guard is not in the table; it is `if (selectedTask)` in the switch body. Walk the
  // switch so the guard is READ rather than assumed — it is half of the contract.
  // Bounded by markers rather than a shape-sensitive regex: indentation and line endings differ
  // between checkouts, and a brittle match here would fail as "contract missing" rather than
  // "parser stale", which is the worse of the two errors to be handed.
  const switchStart = src.indexOf('switch (key) {')
  const switchEnd = src.indexOf('}, [handlers', switchStart)
  if (switchStart === -1 || switchEnd === -1) {
    throw new Error('shortcut switch not found in useKeyboardShortcuts.ts - parser needs updating')
  }
  const switchBody = src.slice(switchStart, switchEnd)

  const guards = new Map<string, boolean>()
  // Consecutive `case 'a':` labels share the body that follows, up to `break`.
  const caseRe = /((?:\s*case '[^']+':)+)([\s\S]*?)break/g
  for (const m of switchBody.matchAll(caseRe)) {
    const keys = [...m[1].matchAll(/case '([^']+)':/g)].map((c) => c[1])
    const requiresSelection = /if \(selectedTask\)/.test(m[2])
    for (const k of keys) guards.set(k, requiresSelection)
  }

  const shortcuts = rows.map((row) => {
    const eventKey = EVENT_KEY[row.key] ?? row.key
    if (!guards.has(eventKey)) {
      throw new Error(`key '${row.key}' (event '${eventKey}') is in the table but has no switch case`)
    }
    return {
      key: row.key,
      eventKey,
      description: row.description,
      // Matches the `onSetPriority(0)` convention the Mac table already uses for traceability.
      webAction: row.param === null ? row.action : `${row.action}(${row.param})`,
      requiresSelection: guards.get(eventKey),
    }
  })

  return { shortcuts }
}

// TZ is pinned for every driver, not just the repeating one. The custom repeat path uses local
// date methods (astrid-core docs/CONTRACTS.md D4), and a fixture generated in another zone would
// silently encode whoever ran it. Pinning it here means a new driver cannot forget.
function runDriver(file: string, label: string): Record<string, unknown> {
  const run = spawnSync(process.execPath, [join(driversDir, file), webRoot], {
    env: { ...process.env, TZ: 'UTC' },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  if (run.status !== 0) {
    throw new Error(`${label} driver failed (exit ${run.status}):\n${run.stderr}`)
  }
  return JSON.parse(run.stdout)
}

// Task identifiers (`AWTD-1007`) are the one contract whose canonical form is a hand-authored CASE
// SET rather than an implementation to run: the server is the only minter, so there is no
// client-side arithmetic to execute — only parsing, autolinking and showing, which every client has
// to agree on. docs/specs/TASK_IDENTIFIERS.md says to change the cases here first; copying them
// through rather than by hand is what makes `--check` fail the moment one is edited.
function exportTaskIdentifiers() {
  const { $comment, ...rest } = JSON.parse(read('tests/fixtures/task-identifiers.json'))
  return { $source: $comment, ...rest }
}

// Order is the order they are written and reported in; the names are what astrid-core reads.
const EXPORTS: Record<string, () => Record<string, unknown>> = {
  'shortcuts.json': exportShortcuts,
  // Repeating rollover is arithmetic, not a table: run, not read.
  'repeating.json': () => runDriver('repeating.mjs', 'repeating'),
  // Permission rules branch and have precedence between them. See the driver for which branches
  // are deliberately left out — the ones no client's data can reach.
  'permissions.json': () => runDriver('permissions.mjs', 'permissions'),
  // Which column a card is in, and what a move writes — the column id is a role rather than a list
  // id, which web itself got wrong twice.
  'board.json': () => runDriver('board.mjs', 'board'),
  // Writing a board's columns — which role a new one mints, which names are refused, that a rename
  // keeps the role — drifts the same way reading them does (task e5214fba).
  'statuses.json': () => runDriver('statuses.mjs', 'statuses'),
  // "What happens to my edit when I click elsewhere" (docs/PRODUCT_CONTRACT.md §6): four
  // transitions and their interactions, run through scripted sequences.
  'editing.json': () => runDriver('editing.mjs', 'editing'),
  // The search box's grammar — aliases, quoting, the identifier shape, the unknown-key fallback
  // (task 5df85b9f).
  'search.json': () => runDriver('search.mjs', 'search'),
  // The quick-add box's natural language, in twelve languages, under a pinned clock, with the
  // keyword tables beside the answers so a client reads the same words.
  'smart.json': () => runDriver('smart.mjs', 'smart'),
  'task-identifiers.json': exportTaskIdentifiers,
  // How a description, comment or chat message reads: web's renderer run in a jsdom window (the
  // browser path, through DOMPurify) and its HTML read back into the core's blocks (AWTD-1064).
  'markdown.json': () => runDriver('markdown.mjs', 'markdown'),
}

let failed = false
mkdirSync(fixturesDir, { recursive: true })
for (const [name, build] of Object.entries(EXPORTS)) {
  const payload = {
    $comment: 'GENERATED by scripts/export-contract-fixtures.ts — do not edit. Source of truth: astrid-web.',
    ...build(),
  }
  const text = JSON.stringify(payload, null, 2) + '\n'
  const path = join(fixturesDir, name)
  if (check) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : ''
    if (current !== text) {
      console.error(`fixture out of date: contracts/fixtures/${name} (run npm run export:contract-fixtures)`)
      failed = true
    } else {
      console.log(`ok  contracts/fixtures/${name}`)
    }
  } else {
    writeFileSync(path, text)
    console.log(`wrote contracts/fixtures/${name}`)
  }
}
process.exit(failed ? 1 : 0)
