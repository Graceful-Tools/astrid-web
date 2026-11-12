// @vitest-environment node
/**
 * Parity proof for the Waiting lane (Jon, 2026-11-12) — the first CORE-FIRST contract.
 *
 * packages/astrid-rules/fixtures/waiting.json is generated in astrid-core from its own rules
 * (`cargo xtask gen-core-contracts`) and vendored at the pinned revision. Every case is replayed
 * against the TypeScript mirror in lib/waiting-rules.ts (the server's fallback, and what the
 * browser uses to decide whether to open the Waiting prompt), and against the vendored WebAssembly
 * installed as the server installs it. Both must give the fixture's answer.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createWaitingCore } from '@/lib/core-rules/waiting-core'
import { loadCoreRulesFrom } from '@/lib/core-rules/wasm'
import {
  boardPresets,
  boardPresetsTs,
  handBackTs,
  resolveWaitingWriteTs,
  setWaitingCore,
  settleWaitingTs,
  waitingSettle,
  waitingWrite,
  wakeWaitingTs,
  WAITING_NEEDS_CONDITION,
  type WaitingChange,
  type WaitingTask,
  type WaitingBlocker,
} from '@/lib/waiting-rules'

const PACKAGE_DIR = path.join(process.cwd(), 'packages', 'astrid-rules')

interface Case {
  name: string
  rule: string
  request: Record<string, unknown> & { kind: string }
  answer: { ok: true; value: unknown } | { ok: false; error: { code: string; kind: string; message: string } }
}
const fixture = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'fixtures', 'waiting.json'), 'utf8')) as {
  waitingNeedsCondition: string
  cases: Case[]
}

const req = (c: Case) => c.request as unknown as {
  task: WaitingTask
  blockers?: WaitingBlocker[]
  change?: WaitingChange
  now: string
  assigneeId?: string
  customStates?: unknown
}

/** The TypeScript's answer, in the fixture's envelope. */
function typescriptAnswer(c: Case): unknown {
  const r = req(c)
  switch (c.request.kind) {
    case 'waitingWrite': {
      const answer = resolveWaitingWriteTs(r.task, r.blockers ?? [], r.change ?? {}, new Date(r.now))
      return answer.ok ? { ok: true, value: answer.value } : { ok: false, code: answer.code, message: answer.message }
    }
    case 'waitingWake':
      return { ok: true, value: { action: wakeWaitingTs(r.task, r.blockers ?? [], new Date(r.now)) } }
    case 'waitingSettle':
      return { ok: true, value: settleWaitingTs(r.task, r.blockers ?? [], new Date(r.now)) }
    case 'handBack':
      return { ok: true, value: handBackTs(r.assigneeId as string) }
    case 'boardPresets':
      return { ok: true, value: boardPresetsTs(r.customStates) }
    default:
      throw new Error(`no TypeScript for ${c.request.kind}`)
  }
}

function expected(c: Case): unknown {
  return c.answer.ok ? c.answer : { ok: false, code: c.answer.error.code, message: c.answer.error.message }
}

afterEach(() => setWaitingCore(null))

describe('waiting.json — the TypeScript mirror (the fallback)', () => {
  it('has the cases the core generated, every kind among them', () => {
    expect(fixture.waitingNeedsCondition).toBe(WAITING_NEEDS_CONDITION)
    const kinds = new Set(fixture.cases.map((c) => c.request.kind))
    expect([...kinds].sort()).toEqual(['boardPresets', 'handBack', 'waitingSettle', 'waitingWake', 'waitingWrite'])
    expect(fixture.cases.some((c) => c.name.startsWith('create/'))).toBe(true)
  })

  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(typescriptAnswer(c)).toEqual(expected(c))
  })
})

describe('waiting.json — through the vendored core, installed as the server installs it', () => {
  const core = loadCoreRulesFrom(PACKAGE_DIR)

  it('decides every write, settle and preset case itself and agrees with the fixture', () => {
    const failures: unknown[] = []
    const hook = createWaitingCore(core.runJson, {
      disagreement: (details) => failures.push(details),
      failure: (details) => failures.push(details),
    }, { revision: core.revision, mode: 'decide', sampleEvery: 1 })
    setWaitingCore({ write: hook.write, settle: hook.settle, presets: hook.presets })

    for (const c of fixture.cases) {
      const r = req(c)
      if (c.request.kind === 'waitingWrite') {
        const answer = waitingWrite(r.task, r.blockers ?? [], r.change ?? {}, new Date(r.now))
        expect(answer.ok ? { ok: true, value: answer.value } : { ok: false, code: answer.code, message: answer.message }, c.name).toEqual(expected(c))
      } else if (c.request.kind === 'waitingSettle') {
        expect({ ok: true, value: waitingSettle(r.task, r.blockers ?? [], new Date(r.now)) }, c.name).toEqual(expected(c))
      } else if (c.request.kind === 'boardPresets') {
        expect({ ok: true, value: boardPresets(r.customStates) }, c.name).toEqual(expected(c))
      }
    }
    const asked = fixture.cases.filter((c) => ['waitingWrite', 'waitingSettle', 'boardPresets'].includes(c.request.kind)).length
    expect(failures).toEqual([])
    expect(hook.stats.failed).toBe(0)
    expect(hook.stats.agreed).toBe(asked)
  })
})
