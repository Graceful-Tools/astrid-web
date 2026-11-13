/**
 * Parity proof for Decision cards and trade-off grids (AWTD-1626): the browser's recogniser held
 * to astrid-core's `astrid_rules::decisions`.
 *
 * lib/comment-formats.ts is client code (CommentSection, DecisionCards, MessageBubble and the grid
 * renderer in lib/markdown.ts), and the browser cannot load the WebAssembly core (see
 * tests/lib/core-rules-markdown-parity.test.ts and docs/architecture/CORE_RULES_FALLBACK_RETIREMENT.md:
 * that waits on "Run core rules in the browser", AWTD-1586). So the web keeps its TypeScript, and
 * this pins it to the core's `decision`, `tradeoffGrid` and `ratingKey` rules, which Windows,
 * Android and the Apple apps call. Every case of contracts/fixtures/decisions.json (generated from
 * comment-formats.ts by scripts/contract-fixtures/drivers/decisions.mjs, vendored at the pinned
 * core revision) is answered by both, and both must answer what the fixture records.
 *
 * `RATING_STYLE`'s `className` values stay on web: they are app/globals.css classes, and the core
 * carries only `labelKey`, `label` and `rank`.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isTradeoffGrid, parseDecision, parseRating, RATING_STYLE, rowName, type Rating } from '@/lib/comment-formats'
import { loadCoreRulesFrom } from '@/lib/core-rules/wasm'

const PACKAGE_DIR = path.join(process.cwd(), 'packages', 'astrid-rules')

interface Fixture {
  decisions: Array<{ name: string; text: string; parsed: unknown }>
  grids: Array<{ name: string; rows: string[][]; isGrid: boolean; cells: unknown; rowNames: string[] }>
  rowMarkers: Array<{ text: string; name: string }>
  ratings: Record<string, { labelKey: string; label: string; rank: number }>
}

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Fixture
const fixture = read(path.join(PACKAGE_DIR, 'fixtures', 'decisions.json'))
const core = loadCoreRulesFrom(PACKAGE_DIR)

function ask(request: Record<string, unknown>): unknown {
  const reply = JSON.parse(core.runJson(JSON.stringify(request))) as { ok: boolean; value: unknown }
  expect(reply.ok).toBe(true)
  return reply.value
}

describe('the decisions fixture at the pinned core revision', () => {
  it('is the one this repo exports', () => {
    // contracts/fixtures/decisions.json is checked against comment-formats.ts by check:contract-fixtures.
    expect(fixture).toEqual(read(path.join(process.cwd(), 'contracts', 'fixtures', 'decisions.json')))
  })
})

describe('a Decision reads the same in the browser and in astrid-core', () => {
  it.each(fixture.decisions.map(c => [c.name, c] as const))('%s', (_name, c) => {
    expect(parseDecision(c.text)).toEqual(c.parsed)
    expect(ask({ kind: 'decision', text: c.text })).toEqual(c.parsed)
  })
})

describe('a trade-off grid reads the same in the browser and in astrid-core', () => {
  it.each(fixture.grids.map(c => [c.name, c] as const))('%s', (_name, c) => {
    const ours = {
      isGrid: isTradeoffGrid(c.rows),
      cells: c.rows.map(row => row.slice(1).map(cell => (cell.trim() === '' ? null : parseRating(cell)))),
      rowNames: c.rows.map(row => rowName(row[0])),
    }
    expect(ours).toEqual({ isGrid: c.isGrid, cells: c.cells, rowNames: c.rowNames })
    expect(ask({ kind: 'tradeoffGrid', rows: c.rows })).toEqual(ours)
  })

  it.each(fixture.rowMarkers.map(c => [c.text, c] as const))('row marker %s', (_text, c) => {
    expect(rowName(c.text)).toBe(c.name)
    expect((ask({ kind: 'tradeoffGrid', rows: [[c.text, '+']] }) as { rowNames: string[] }).rowNames).toEqual([c.name])
  })
})

describe('the rating key', () => {
  it('is every token RATING_STYLE knows, with the same word and rank, worst to best', () => {
    const key = ask({ kind: 'ratingKey' }) as Array<{ token: Rating; labelKey: string; label: string; rank: number }>
    const ours = Object.entries(RATING_STYLE).map(([token, s]) => ({ token, labelKey: s.labelKey, label: s.label, rank: s.rank }))
    const byToken = (a: { token: string }, b: { token: string }) => (a.token < b.token ? -1 : a.token > b.token ? 1 : 0)
    expect([...key].sort(byToken)).toEqual([...ours].sort(byToken))
    expect(key.map(k => k.rank)).toEqual([...key.map(k => k.rank)].sort((a, b) => a - b))
    expect(Object.fromEntries(key.map(({ token, ...rest }) => [token, rest]))).toEqual(fixture.ratings)
  })
})
