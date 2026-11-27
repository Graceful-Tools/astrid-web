// @vitest-environment node
/**
 * Parity proof for lib/search-query-parser.ts parsed by astrid-core (AWTD-1062; ADEV-313).
 *
 * The search fixture is astrid-core's own (docs/CONTRACTS.md there names the core canonical; `cargo
 * xtask gen-core-contracts` generates it) and is vendored at the pinned core revision. Web has no
 * TypeScript parser beside it: every query goes through parseSearchQuery with the vendored
 * WebAssembly core installed as the server installs it, and must give the fixture's parse, with the
 * core answering every query itself.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isEmptySearch, parseSearchQuery, priorityToNumber, setSearchQueryCore } from '@/lib/search-query-parser'
import { createSearchQueryCore } from '@/lib/core-rules/search-query-core'
import { loadCoreRulesFrom } from '@/lib/core-rules/wasm'

const PACKAGE_DIR = path.join(process.cwd(), 'packages', 'astrid-rules')

interface Fixture {
  priorityNumbers: Record<string, number>
  queries: Array<{ query: string; parsed: ReturnType<typeof parseSearchQuery>; isEmpty: boolean }>
}

const fixture = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'fixtures', 'search.json'), 'utf8')) as Fixture
const core = loadCoreRulesFrom(PACKAGE_DIR)
const cases = fixture.queries.map((c) => [JSON.stringify(c.query), c] as const)

afterEach(() => setSearchQueryCore(null))

describe('the search fixture at the pinned core revision', () => {
  it('has no web copy: astrid-core generates it (ADEV-313)', () => {
    expect(fixture.queries.length).toBeGreaterThanOrEqual(30)
    expect(() => readFileSync(path.join(process.cwd(), 'contracts', 'fixtures', 'search.json'))).toThrow()
  })

  it('numbers priorities as the fixture does', () => {
    for (const [word, number] of Object.entries(fixture.priorityNumbers)) {
      expect(priorityToNumber(word as Parameters<typeof priorityToNumber>[0])).toBe(number)
    }
  })
})

describe('parseSearchQuery with astrid-core parsing, as the server runs it', () => {
  it.each(cases)('%s', (_name, { query, parsed, isEmpty }) => {
    const reports: unknown[] = []
    const parser = createSearchQueryCore(core.runJson, {
      failure: (d) => reports.push(d),
    })
    setSearchQueryCore(parser.parse)

    const answer = parseSearchQuery(query)
    expect(answer).toEqual(parsed)
    expect(isEmptySearch(answer)).toBe(isEmpty)
    expect(reports).toEqual([])
    expect(parser.stats).toEqual({ answered: 1, skipped: 0, failed: 0 })
  })
})
