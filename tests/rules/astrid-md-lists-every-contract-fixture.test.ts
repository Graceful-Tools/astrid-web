/**
 * AWTD-1323: ASTRID.md's §8 "Cross-platform contracts" table is how an agent
 * learns that editing a file is a cross-repo change. `my-tasks.json` and
 * `wire-shapes.json` were added to the exporter without a row, so four
 * canonical source files carried no warning — and nothing could notice:
 * check:contract-fixtures compares fixture CONTENT, check:docs validates links.
 *
 * The registry is `EXPORTS` in scripts/export-contract-fixtures.ts. Every key
 * there must have a row in the table, and every row must still be exported.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

function exportedFixtures(): string[] {
  const source = readFileSync('scripts/export-contract-fixtures.ts', 'utf8')
  const start = source.indexOf('const EXPORTS')
  const body = source.slice(start, source.indexOf('\n}\n', start))
  return [...body.matchAll(/^\s*'([\w-]+\.json)':/gm)].map(m => m[1]).sort()
}

function tabledFixtures(): string[] {
  const doc = readFileSync('ASTRID.md', 'utf8')
  const start = doc.indexOf('| Fixture | Canonical source (web) |')
  expect(start, 'ASTRID.md has no fixture table').toBeGreaterThan(-1)
  const rows = doc.slice(start).split('\n\n')[0].split('\n')
  return rows.map(row => row.match(/^\|\s*`([\w-]+\.json)`\s*\|/)?.[1]).filter((x): x is string => !!x).sort()
}

describe('ASTRID.md lists every contract fixture (AWTD-1323)', () => {
  it('reads the registry, so it cannot pass by matching nothing', () => {
    expect(exportedFixtures().length).toBeGreaterThanOrEqual(15)
  })

  it('has one table row per exported fixture, and no row for one that is gone', () => {
    expect(tabledFixtures()).toEqual(exportedFixtures())
  })
})
