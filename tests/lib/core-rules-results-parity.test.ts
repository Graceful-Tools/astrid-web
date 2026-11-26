// @vitest-environment node
/**
 * Parity proof for the Pending results lane (ADEV-274 in astrid-core, ADEV-279 here), a CORE-FIRST
 * contract like the Waiting lane's.
 *
 * packages/astrid-rules/fixtures/results.json is generated in astrid-core from its own rules
 * (`cargo xtask gen-core-contracts`) and vendored at the pinned revision. Every case is replayed
 * against the TypeScript mirror in lib/results-rules.ts (the server's fallback), and against the
 * vendored WebAssembly installed as the server installs it. Both must give the fixture's answer.
 *
 * This needs packages/astrid-rules at astrid-core ae86e89 or later (scripts/build-astrid-rules.sh);
 * a pin from before ADEV-274 has no fixture and no `resultsWrite`.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createResultsCore } from '@/lib/core-rules/results-core'
import { loadCoreRulesFrom } from '@/lib/core-rules/wasm'
import {
  RESULTS_NEEDS_CONDITION,
  resolveResultsWriteTs,
  resultsSettle,
  resultsWrite,
  setResultsCore,
  settleResultsTs,
  type ResultCondition,
  type ResultsChange,
  type ResultsTask,
} from '@/lib/results-rules'

const PACKAGE_DIR = path.join(process.cwd(), 'packages', 'astrid-rules')

interface Case {
  name: string
  rule: string
  request: Record<string, unknown> & { kind: string }
  answer: { ok: true; value: unknown } | { ok: false; error: { code: string; kind: string; message: string } }
}
const fixture = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'fixtures', 'results.json'), 'utf8')) as { cases: Case[] }

const req = (c: Case) => c.request as unknown as {
  task: ResultsTask
  conditions?: ResultCondition[]
  change?: ResultsChange
  escalateToAssigneeId?: string
  now: string
}

/** The fixture writes absent keys as `null` on a condition; the wire form drops what is null. */
const conditionsOf = (c: Case): ResultCondition[] =>
  (req(c).conditions ?? []).map(raw => {
    const r = raw as unknown as Record<string, unknown>
    const condition: Record<string, unknown> = { kind: r.kind, state: r.state }
    if (r.verdict) condition.verdict = r.verdict
    if (r.decideBy) condition.decideBy = r.decideBy
    if (r.fetchedAt) condition.fetchedAt = r.fetchedAt
    return condition as unknown as ResultCondition
  })

function expected(c: Case): unknown {
  return c.answer.ok ? c.answer : { ok: false, code: c.answer.error.code, message: c.answer.error.message }
}

function typescriptAnswer(c: Case): unknown {
  const r = req(c)
  switch (c.request.kind) {
    case 'resultsWrite': {
      const answer = resolveResultsWriteTs(r.task, conditionsOf(c), r.change ?? {}, new Date(r.now))
      return answer.ok ? { ok: true, value: answer.value } : { ok: false, code: answer.code, message: answer.message }
    }
    case 'resultsSettle':
      return { ok: true, value: settleResultsTs(r.task, conditionsOf(c), r.escalateToAssigneeId as string, new Date(r.now)) }
    default:
      throw new Error(`no TypeScript for ${c.request.kind}`)
  }
}

afterEach(() => setResultsCore(null))

describe('results.json — the TypeScript mirror (the fallback)', () => {
  it('has the cases the core generated, both kinds among them', () => {
    expect([...new Set(fixture.cases.map(c => c.request.kind))].sort()).toEqual(['resultsSettle', 'resultsWrite'])
    expect(fixture.cases.some(c => !c.answer.ok && c.answer.error.code === RESULTS_NEEDS_CONDITION)).toBe(true)
  })

  it.each(fixture.cases.map(c => [c.name, c] as const))('%s', (_name, c) => {
    expect(typescriptAnswer(c)).toEqual(expected(c))
  })
})

describe('results.json — through the vendored core, installed as the server installs it', () => {
  const core = loadCoreRulesFrom(PACKAGE_DIR)

  it('decides every write and settle case itself and agrees with the fixture', () => {
    const failures: unknown[] = []
    const hook = createResultsCore(core.runJson, {
      disagreement: details => failures.push(details),
      failure: details => failures.push(details),
    }, { revision: core.revision, mode: 'decide', sampleEvery: 1 })
    setResultsCore({ write: hook.write, settle: hook.settle })

    for (const c of fixture.cases) {
      const r = req(c)
      if (c.request.kind === 'resultsWrite') {
        const answer = resultsWrite(r.task, conditionsOf(c), r.change ?? {}, new Date(r.now))
        expect(answer.ok ? { ok: true, value: answer.value } : { ok: false, code: answer.code, message: answer.message }, c.name).toEqual(expected(c))
      } else {
        expect({ ok: true, value: resultsSettle(r.task, conditionsOf(c), r.escalateToAssigneeId as string, new Date(r.now)) }, c.name).toEqual(expected(c))
      }
    }
    expect(failures).toEqual([])
    expect(hook.stats.failed).toBe(0)
    expect(hook.stats.agreed).toBe(fixture.cases.length)
  })
})
