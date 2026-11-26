// @vitest-environment node
/**
 * ADEV-281 — the trade-off policy, held to astrid-core's own fixture.
 *
 * packages/astrid-rules/fixtures/tradeoff.json is astrid-core's contracts/fixtures/tradeoff.json
 * (core-first, ADEV-273), vendored by scripts/build-astrid-rules.sh at the pinned REVISION.
 *
 * - Every `tradeoffEvaluate` case runs through the server's entry point (lib/core-rules/tradeoff-core.ts),
 *   which asks the vendored build. The sort key is stored in JSON and sent back as i64, so the entry
 *   point clamps the core's "unknown" (`i64::MAX`) to the safe-integer range; the expected answers
 *   are clamped the same way, and the order must not change.
 * - The policy's *shape* is mirrored in TypeScript for the settings UI: the two refused cases must
 *   be refused with the core's own message, and every stored key must be accepted.
 * - The `policy` sort cases run through lib/task-sort.ts, which compares stored keys and never
 *   evaluates, and through the core's `rows` door.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  coreAnswersTradeoff,
  evaluateTradeoff,
  setTradeoffCoreForTests,
  storableSortKey,
} from '@/lib/core-rules/tradeoff-core'
import { loadCoreRulesFrom, type CoreRules } from '@/lib/core-rules/wasm'
import { parsePolicyOverride } from '@/lib/orchestration-policy'
import { compareSortKeys, sortTasksForList } from '@/lib/task-sort'
import type { Task } from '@/types/task'

interface Case {
  name: string
  rule: string
  request: { kind: string; project?: unknown; list?: unknown; estimate?: unknown; tasks?: unknown[] }
  answer: { ok: true; value: any } | { ok: false; error: { kind: string; message: string } }
}

const PACKAGE_DIR = process.env.ASTRID_RULES_DIR ?? path.join(process.cwd(), 'packages', 'astrid-rules')
const fixture = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'fixtures', 'tradeoff.json'), 'utf8')) as { cases: Case[] }

const evaluateCases = fixture.cases.filter(c => c.request.kind === 'tradeoffEvaluate')
const sortCases = fixture.cases.filter(c => c.request.kind === 'rows')

function vendoredCore(): CoreRules | null {
  try {
    return loadCoreRulesFrom(PACKAGE_DIR)
  } catch {
    return null
  }
}

afterEach(() => setTradeoffCoreForTests(undefined))

describe('tradeoff.json — the vendored build answers (ADEV-281)', () => {
  it('has the core\'s cases, evaluate and sort', () => {
    expect(evaluateCases.length).toBe(19)
    expect(sortCases.length).toBe(2)
  })

  it('loads and answers tradeoffEvaluate, so the server asks the core', () => {
    expect(coreAnswersTradeoff(vendoredCore())).toBe(true)
  })

  for (const c of evaluateCases) {
    it(`evaluate: ${c.name}`, () => {
      setTradeoffCoreForTests(vendoredCore())
      const answer = evaluateTradeoff({ project: c.request.project, list: c.request.list }, c.request.estimate as never)
      const expected = c.answer.ok && c.answer.value
        ? { ok: true, value: { ...c.answer.value, sortKey: storableSortKey(c.answer.value.sortKey) } }
        : c.answer
      expect(answer).toEqual(expected)
    })
  }

  it('answers null, never a made-up label, when no build answers', () => {
    setTradeoffCoreForTests(null)
    expect(evaluateTradeoff({ project: { tradeoff: {} } }, null)).toBeNull()
  })
})

describe('the sort key survives a JSON column and the trip back to the core (ADEV-281)', () => {
  it('clamps i64::MAX to a safe integer that still sorts after every real value', () => {
    const stored = storableSortKey([2, 9223372036854775807, -1795132800000])
    expect(stored).toEqual([2, Number.MAX_SAFE_INTEGER, -1795132800000])
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored)
    expect(Number.isSafeInteger(stored[1])).toBe(true)
    expect(stored[1]).toBeGreaterThan(1e15) // the largest cost an estimate may carry (lib/task-estimate.ts)
  })

  it('keeps the order the core gave: an unknown cost sorts after a known one', () => {
    const known = storableSortKey([0, 0, 1, 0, 0, 5_000_000, -1])
    const unknown = storableSortKey([0, 0, 1, 0, 0, 9223372036854775807, -1])
    expect(compareSortKeys(known, unknown)).toBe(-1)
  })
})

describe('tradeoff policy shape — the TypeScript mirror (ADEV-281)', () => {
  for (const c of evaluateCases.filter(c => !c.answer.ok)) {
    it(`refuses as the core does: ${c.name}`, () => {
      const refused = parsePolicyOverride(c.request.project)
      expect(refused).toEqual(c.answer)
    })
  }

  it('accepts every policy the fixture stores', () => {
    for (const c of evaluateCases.filter(c => c.answer.ok)) {
      expect(parsePolicyOverride(c.request.project).ok, c.name).toBe(true)
      expect(parsePolicyOverride(c.request.list).ok, c.name).toBe(true)
    }
  })

  it('keeps an empty tradeoff key: it states a policy (the defaults)', () => {
    expect(parsePolicyOverride({ tradeoff: {} })).toEqual({ ok: true, value: { tradeoff: {} } })
  })

  it('refuses an unknown field rather than ignoring it', () => {
    const answer = parsePolicyOverride({ tradeoff: { weight: 3 } })
    expect(answer.ok).toBe(false)
  })
})

describe('the policy sort compares stored keys (ADEV-281, astrid-core D75)', () => {
  const toTasks = (rows: any[]) =>
    rows.map(row => ({ priority: 0, repeating: 'never', completed: false, createdAt: new Date('2026-01-01'), ...row })) as Task[]

  for (const c of sortCases) {
    it(`TypeScript: ${c.name}`, () => {
      const answer = c.answer as { ok: true; value: { ids: string[] } }
      const sorted = sortTasksForList(toTasks(c.request.tasks as any[]), 'policy')
      expect(sorted.map(task => task.id)).toEqual(answer.value.ids)
    })

    it(`core: ${c.name}`, () => {
      expect(JSON.parse(vendoredCore()!.runJson(JSON.stringify(c.request)))).toEqual(c.answer)
    })
  }

  it('lexicographic: a shorter key that is a prefix comes first, and smaller wins at the first difference', () => {
    expect(compareSortKeys([0], [0, 1])).toBeLessThan(0)
    expect(compareSortKeys([0, 2, 0], [0, 1, 9])).toBeGreaterThan(0)
    expect(compareSortKeys([1, 2], [1, 2])).toBe(0)
  })
})
