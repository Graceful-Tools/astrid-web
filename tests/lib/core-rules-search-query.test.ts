// @vitest-environment node
/**
 * astrid-core parses search queries on the server (AWTD-1062) — and fails safe. Whatever the core
 * does short of answering (cannot load, throws, answers garbage or an error envelope),
 * parseSearchQuery returns the TypeScript parse, and nothing escapes to GET /api/v1/search. When
 * it does answer, its parse is returned, and a disagreement is logged without the query.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseSearchQuery, setSearchQueryCore, type ParsedSearchQuery } from '@/lib/search-query-parser'
import {
  createSearchQueryCore,
  installSearchQueryCore,
  searchQueryCoreStatus,
} from '@/lib/core-rules/search-query-core'

function silentReporter() {
  return { disagreement: vi.fn(), failure: vi.fn() }
}

const EMPTY: ParsedSearchQuery = {
  text: '',
  assignee: null,
  listNames: [],
  labelNames: [],
  priorities: [],
  due: null,
  state: null,
  statuses: [],
  identifier: null,
}

/** A core that answers `value` (plus `isEmpty`) to every query. */
const answering = (value: Record<string, unknown>) => vi.fn(() => JSON.stringify({ ok: true, value }))

afterEach(() => {
  setSearchQueryCore(null)
  vi.doUnmock('@/lib/core-rules/wasm')
  vi.resetModules()
})

describe('the core parses', () => {
  it('returns the core parse, not the TypeScript one, in decide mode', () => {
    // A core that disagrees is the only way to see whose answer came back.
    const report = silentReporter()
    const core = answering({ ...EMPTY, text: 'from-core', isEmpty: false })
    const parser = createSearchQueryCore(core, report)
    setSearchQueryCore(parser.parse)

    expect(parseSearchQuery('rollover').text).toBe('from-core')
    expect(core).toHaveBeenCalledWith(JSON.stringify({ kind: 'searchParse', query: 'rollover' }))
    expect(parser.stats).toMatchObject({ disagreed: 1, agreed: 0, failed: 0 })
  })

  it('reports a disagreement by field and token count, never the query or the parses', () => {
    const report = silentReporter()
    const parser = createSearchQueryCore(answering({ ...EMPTY, text: 'x', isEmpty: false }), report)
    setSearchQueryCore(parser.parse)

    parseSearchQuery('secret project name')
    parseSearchQuery('another secret phrase') // same shape: logged once

    expect(report.disagreement).toHaveBeenCalledTimes(1)
    const details = report.disagreement.mock.calls[0][0]
    expect(details).toMatchObject({ rule: 'searchParse', differing: ['text'], tokens: 3, returned: 'core' })
    expect(JSON.stringify(details)).not.toMatch(/secret|project|another/)
  })

  it('counts agreement when the core parses as the TypeScript does', () => {
    const parser = createSearchQueryCore(answering({ ...EMPTY, text: 'rollover', isEmpty: false }), silentReporter())
    setSearchQueryCore(parser.parse)
    expect(parseSearchQuery('rollover').text).toBe('rollover')
    expect(parser.stats).toMatchObject({ agreed: 1, disagreed: 0 })
  })

  it('keeps the TypeScript parse in shadow mode, and still compares', () => {
    const report = silentReporter()
    const parser = createSearchQueryCore(answering({ ...EMPTY, text: 'from-core', isEmpty: false }), report, { mode: 'shadow' })
    setSearchQueryCore(parser.parse)
    expect(parseSearchQuery('rollover').text).toBe('rollover')
    expect(report.disagreement).toHaveBeenCalledWith(expect.objectContaining({ returned: 'typescript' }))
  })
})

describe('the TypeScript answer stands whenever the core cannot give one', () => {
  const cases: Array<[string, (request: string) => string]> = [
    ['an error envelope', () => JSON.stringify({ ok: false, error: { kind: 'badRequest' } })],
    ['not JSON', () => 'nonsense'],
    ['a missing field', () => JSON.stringify({ ok: true, value: { text: 'x', isEmpty: false } })],
    ['a priority outside the vocabulary', () => JSON.stringify({ ok: true, value: { ...EMPTY, priorities: ['urgent'], isEmpty: false } })],
    ['a due outside the vocabulary', () => JSON.stringify({ ok: true, value: { ...EMPTY, due: 'someday', isEmpty: false } })],
    ['an isEmpty that contradicts its own parse', () => JSON.stringify({ ok: true, value: { ...EMPTY, text: 'x', isEmpty: true } })],
  ]

  it.each(cases)('%s', (_name, runJson) => {
    const report = silentReporter()
    const parser = createSearchQueryCore(runJson, report)
    setSearchQueryCore(parser.parse)
    expect(parseSearchQuery('assignee:me rollover')).toEqual({ ...EMPTY, assignee: 'me', text: 'rollover' })
    expect(parser.stats.failed).toBe(1)
    expect(report.failure).toHaveBeenCalledTimes(1)
  })

  it('switches a core that throws off for the rest of the process', () => {
    const runJson = vi.fn(() => {
      throw new Error('unreachable')
    })
    const parser = createSearchQueryCore(runJson, silentReporter())
    setSearchQueryCore(parser.parse)
    expect(parseSearchQuery('a').text).toBe('a')
    expect(parseSearchQuery('b').text).toBe('b')
    expect(runJson).toHaveBeenCalledTimes(1)
    expect(parser.stats.failed).toBe(2)
  })

  it('survives a hook that itself throws, or answers something that is not a parse', () => {
    setSearchQueryCore(() => {
      throw new Error('boom')
    })
    expect(parseSearchQuery('due:today').due).toBe('today')
    setSearchQueryCore(() => ({ nonsense: true }) as unknown as ParsedSearchQuery)
    expect(parseSearchQuery('due:today').due).toBe('today')
  })
})

describe('installSearchQueryCore', () => {
  it('installs the vendored core, which then parses', () => {
    expect(installSearchQueryCore(undefined)).toBe(true)
    expect(searchQueryCoreStatus()).toMatchObject({ mode: 'decide', loaded: true, revision: expect.stringMatching(/^[0-9a-f]{40}$/) })
    expect(parseSearchQuery('priority:urgent AST-142')).toMatchObject({ priorities: ['high'], identifier: 'AST-142' })
    expect(searchQueryCoreStatus()?.stats).toMatchObject({ agreed: 1, failed: 0 })
  })

  it('installs nothing when switched off', () => {
    expect(installSearchQueryCore('off')).toBe(false)
    expect(searchQueryCoreStatus()).toMatchObject({ mode: 'off', loaded: false })
  })

  it('leaves the TypeScript parsing when the build does not load', async () => {
    vi.resetModules()
    vi.doMock('@/lib/core-rules/wasm', () => ({ loadCoreRules: () => null }))
    const fresh = await import('@/lib/core-rules/search-query-core')
    expect(fresh.installSearchQueryCore(undefined)).toBe(false)
    expect(fresh.searchQueryCoreStatus()).toMatchObject({ mode: 'decide', loaded: false, revision: null })
  })
})
