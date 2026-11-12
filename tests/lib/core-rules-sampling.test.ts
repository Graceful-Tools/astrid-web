// @vitest-environment node
/**
 * AWTD-1591: the server samples the core/TypeScript comparison instead of running both on every
 * decision. In decide mode the core answers and the TypeScript runs on 1 decision in N (or when
 * the core cannot answer); in shadow mode the TypeScript decides and the core is asked on 1 in N.
 * The totals stay readable: agreed + disagreed is the number of comparisons, unsampled the rest.
 */
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SAMPLE_EVERY, createSampler, sampleEveryFrom } from '@/lib/core-rules/sampling'
import { createListPermissionsCore } from '@/lib/core-rules/list-permissions-core'
import { createSearchQueryCore } from '@/lib/core-rules/search-query-core'
import { createRepeatingCore } from '@/lib/core-rules/repeating-core'
import { createBoardCore } from '@/lib/core-rules/board-core'
import { loadCoreRulesFrom } from '@/lib/core-rules/wasm'
import { canUserManageList, setListPermissionsCore } from '@/lib/list-permissions'
import { parseSearchQuery, setSearchQueryCore } from '@/lib/search-query-parser'
import { nextOccurrenceForTask, setRepeatingCore } from '@/lib/repeating-rollover'
import { setBoardCore } from '@/lib/board-core-hook'
import { getProjectBoardColumns } from '@/lib/project-status'

const core = loadCoreRulesFrom(path.join(process.cwd(), 'packages', 'astrid-rules'))
const quiet = { disagreement: () => {}, failure: () => {} }

afterEach(() => {
  setListPermissionsCore(null)
  setSearchQueryCore(null)
  setRepeatingCore(null)
  setBoardCore(null)
})

describe('AWTD-1591: the sample rate', () => {
  it('reads ASTRID_CORE_RULES_SAMPLE: a whole number of at least 1, else the default', () => {
    expect(sampleEveryFrom(undefined)).toBe(DEFAULT_SAMPLE_EVERY)
    expect(sampleEveryFrom('1')).toBe(1)
    expect(sampleEveryFrom(' 50 ')).toBe(50)
    for (const unreadable of ['0', '-3', '2.5', 'often', '']) expect(sampleEveryFrom(unreadable)).toBe(DEFAULT_SAMPLE_EVERY)
  })

  it('samples the first decision, then every N-th', () => {
    const sampled = createSampler(3)
    expect(Array.from({ length: 7 }, () => sampled())).toEqual([true, false, false, true, false, false, true])
    expect(Array.from({ length: 3 }, createSampler(1))).toEqual([true, true, true])
  })
})

describe('AWTD-1591: decide mode runs the TypeScript only on sampled decisions', () => {
  it('list permissions: one wasm call per decision; the TypeScript 1 in N', () => {
    const runJson = vi.fn(core.runJson)
    const decider = createListPermissionsCore(runJson, quiet, { sampleEvery: 4 })
    setListPermissionsCore(decider.decide)
    const typescript = vi.fn(() => true)
    const list = { id: 'l', ownerId: 'me', privacy: 'PRIVATE', listMembers: [] }
    for (let i = 0; i < 8; i++) {
      expect(decider.decide({ decision: 'canManage', user: { id: 'me' }, list, typescriptAnswer: typescript })).toBe(true)
    }
    expect(runJson).toHaveBeenCalledTimes(8)
    expect(typescript).toHaveBeenCalledTimes(2)
    expect(decider.stats).toEqual({ agreed: 2, disagreed: 0, unsampled: 6, skipped: 0, failed: 0 })
    // And through the public function, the answer is the core's whether sampled or not.
    for (let i = 0; i < 5; i++) expect(canUserManageList({ id: 'me' }, list)).toBe(true)
  })

  it('search: the TypeScript parse runs 1 in N', () => {
    const parser = createSearchQueryCore(core.runJson, quiet, { sampleEvery: 3 })
    const typescript = vi.fn(() => parseSearchQueryWithoutCore('milk'))
    for (let i = 0; i < 6; i++) parser.parse('milk', typescript)
    expect(typescript).toHaveBeenCalledTimes(2)
    expect(parser.stats).toMatchObject({ agreed: 2, disagreed: 0, unsampled: 4, failed: 0 })
  })

  it('repeating: the TypeScript rollover runs 1 in N', () => {
    const hook = createRepeatingCore(core.runJson, quiet, { sampleEvery: 2 })
    setRepeatingCore(hook.next)
    const input = { repeating: 'daily', pattern: null, currentDueDate: '2026-11-10T09:00:00.000Z', completion: '2026-11-10T10:00:00.000Z', repeatFrom: 'DUE_DATE', occurrenceCount: 0, timeZone: 'UTC', isAllDay: false } as const
    for (let i = 0; i < 4; i++) nextOccurrenceForTask(input)
    expect(hook.stats).toMatchObject({ agreed: 2, disagreed: 0, unsampled: 2, failed: 0 })
  })

  it('board: the TypeScript columns are drawn 1 in N', () => {
    const hook = createBoardCore(core.runJson, quiet, { sampleEvery: 5 })
    setBoardCore({ columns: hook.columns, move: hook.move })
    for (let i = 0; i < 10; i++) getProjectBoardColumns(null)
    expect(hook.stats).toEqual({ agreed: 2, disagreed: 0, unsampled: 8, skipped: 0, failed: 0 })
  })

  it('a disagreement found on a sample is still reported, and the core still decides', () => {
    const reports: unknown[] = []
    const parser = createSearchQueryCore(core.runJson, { disagreement: (d) => reports.push(d), failure: () => {} }, { sampleEvery: 2 })
    const wrong = () => ({ ...parseSearchQueryWithoutCore('milk'), text: 'not milk' })
    expect(parser.parse('milk', wrong)?.text).toBe('milk')
    expect(parser.parse('milk', wrong)?.text).toBe('milk')
    expect(parser.stats).toMatchObject({ disagreed: 1, unsampled: 1 })
    expect(reports).toHaveLength(1)
  })
})

describe('AWTD-1591: the fallback is unchanged', () => {
  it('a core that cannot answer still gets the TypeScript answer, sampled or not', () => {
    const expected = parseSearchQueryWithoutCore('milk')
    const parser = createSearchQueryCore(() => JSON.stringify({ ok: false, error: { kind: 'badRequest' } }), quiet, { sampleEvery: 100 })
    setSearchQueryCore(parser.parse)
    for (let i = 0; i < 3; i++) expect(parseSearchQuery('milk')).toEqual(expected)
    expect(parser.stats).toMatchObject({ failed: 3, agreed: 0, unsampled: 0 })
  })
})

describe('AWTD-1591: shadow mode asks the core only on sampled decisions', () => {
  it('calls runJson 1 in N, and the TypeScript decides every time', () => {
    const runJson = vi.fn(core.runJson)
    const hook = createBoardCore(runJson, quiet, { mode: 'shadow', sampleEvery: 4 })
    setBoardCore({ columns: hook.columns, move: hook.move })
    for (let i = 0; i < 8; i++) expect(getProjectBoardColumns(null)).toHaveLength(5)
    expect(runJson).toHaveBeenCalledTimes(2)
    expect(hook.stats).toMatchObject({ agreed: 2, unsampled: 6 })
  })
})

/** The TypeScript parse, with no core installed. */
function parseSearchQueryWithoutCore(query: string) {
  setSearchQueryCore(null)
  return parseSearchQuery(query)
}
