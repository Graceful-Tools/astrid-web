// @vitest-environment node
/**
 * AWTD-1591: the server samples the core/TypeScript comparison instead of running both on every
 * decision. In decide mode the core answers and the TypeScript runs on 1 decision in N (or when
 * the core cannot answer); in shadow mode the TypeScript decides and the core is asked on 1 in N.
 * The totals stay readable: agreed + disagreed is the number of comparisons, unsampled the rest.
 *
 * Since AWTD-1608 only board drops and the Waiting lane are still compared: listAccess,
 * searchParse, nextOccurrence and the board's columns are not (tests/lib/core-rules-step-a-awtd-1608.test.ts).
 */
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SAMPLE_EVERY, createSampler, sampleEveryFrom } from '@/lib/core-rules/sampling'
import { createBoardCore } from '@/lib/core-rules/board-core'
import { loadCoreRulesFrom } from '@/lib/core-rules/wasm'
import { columnMoveThroughCore, setBoardCore, type CoreMoveQuestion } from '@/lib/board-core-hook'

const core = loadCoreRulesFrom(path.join(process.cwd(), 'packages', 'astrid-rules'))
const quiet = { disagreement: () => {}, failure: () => {} }
const drop: CoreMoveQuestion = { task: { completed: false, statusRole: null, listIds: ['l1'] }, column: { id: 'doing', kind: 'status' }, lists: [{ id: 'l1' }] }
const typescriptDrop = () => ({ listIds: ['l1'], completed: false, statusRole: 'doing' })

afterEach(() => setBoardCore(null))

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

describe('AWTD-1591: board drops are compared 1 in N', () => {
  it('decide mode: one wasm call per drop; the TypeScript 1 in N', () => {
    const runJson = vi.fn(core.runJson)
    const hook = createBoardCore(runJson, quiet, { sampleEvery: 4 })
    setBoardCore({ columns: hook.columns, move: hook.move })
    const typescript = vi.fn(typescriptDrop)
    for (let i = 0; i < 8; i++) expect(columnMoveThroughCore(drop, typescript)).toEqual(typescriptDrop())
    expect(runJson).toHaveBeenCalledTimes(8)
    expect(typescript).toHaveBeenCalledTimes(2)
    expect(hook.stats.drops).toEqual({ agreed: 2, disagreed: 0, unsampled: 6, skipped: 0, failed: 0 })
  })

  it('shadow mode: the core is asked 1 in N, and the TypeScript decides every time', () => {
    const runJson = vi.fn(core.runJson)
    const hook = createBoardCore(runJson, quiet, { mode: 'shadow', sampleEvery: 4 })
    setBoardCore({ columns: hook.columns, move: hook.move })
    for (let i = 0; i < 8; i++) expect(columnMoveThroughCore(drop, typescriptDrop)).toEqual(typescriptDrop())
    expect(runJson).toHaveBeenCalledTimes(2)
    expect(hook.stats.drops).toMatchObject({ agreed: 2, unsampled: 6 })
  })

  it('a core that cannot answer still gets the TypeScript answer, sampled or not', () => {
    const hook = createBoardCore(() => JSON.stringify({ ok: false, error: { kind: 'badRequest' } }), quiet, { sampleEvery: 100 })
    setBoardCore({ columns: hook.columns, move: hook.move })
    for (let i = 0; i < 3; i++) expect(columnMoveThroughCore(drop, typescriptDrop)).toEqual(typescriptDrop())
    expect(hook.stats.drops).toMatchObject({ failed: 3, agreed: 0, unsampled: 0 })
  })
})
