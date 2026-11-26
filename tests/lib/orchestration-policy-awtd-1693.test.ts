// @vitest-environment node
/**
 * AWTD-1693 — the orchestration policy, held to astrid-core's own fixture.
 *
 * packages/astrid-rules/fixtures/orchestration.json is astrid-core's contracts/fixtures/orchestration.json
 * (core-first, AWTD-1685), vendored by scripts/build-astrid-rules.sh at the pinned REVISION.
 *
 * Every case is replayed against:
 * - the vendored core build, which the server asks (and which must answer: a build that refuses the
 *   kinds fails here rather than quietly handing every answer to the mirror);
 * - the TypeScript mirror (lib/orchestration-policy.ts), which the settings UI uses in the browser
 *   and the server falls back to;
 * - the server's entry point (lib/core-rules/orchestration-core.ts) with each engine forced.
 *
 * `ASTRID_RULES_DIR=<dir>` points the core half at another build (for example one made with
 * `scripts/build-astrid-rules.sh --rev <sha>` in a scratch checkout).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  coreAnswersOrchestration,
  effectiveOrchestrationPolicy,
  orchestrationEngine,
  runOrchestration,
  setOrchestrationCoreForTests,
} from '@/lib/core-rules/orchestration-core'
import { loadCoreRulesFrom, type CoreRules } from '@/lib/core-rules/wasm'
import {
  defaultOrchestrationPolicy,
  defaultTradeoffPolicy,
  parsePolicyOverride,
  runOrchestrationTs,
  withAssignTo,
  withAutonomy,
  withEscalation,
  type OrchestrationRequest,
} from '@/lib/orchestration-policy'

interface Case {
  name: string
  rule: string
  request: OrchestrationRequest & { project: unknown; list: unknown }
  answer: { ok: true; value: unknown } | { ok: false; error: { kind: string; message: string } }
}

const PACKAGE_DIR = process.env.ASTRID_RULES_DIR ?? path.join(process.cwd(), 'packages', 'astrid-rules')

const fixture = JSON.parse(
  readFileSync(path.join(PACKAGE_DIR, 'fixtures', 'orchestration.json'), 'utf8'),
) as { astridPolicy: unknown; cases: Case[] }

function vendoredCore(): CoreRules | null {
  try {
    return loadCoreRulesFrom(PACKAGE_DIR)
  } catch {
    return null
  }
}

afterEach(() => setOrchestrationCoreForTests(undefined))

describe('orchestration.json — the TypeScript mirror (AWTD-1693)', () => {
  it('has the core\'s 37 cases, every kind among them', () => {
    expect(fixture.cases).toHaveLength(37)
    expect(new Set(fixture.cases.map(c => c.request.kind))).toEqual(
      new Set(['orchestrationPolicy', 'orchestrationRoute', 'orchestrationMay', 'orchestrationEscalate']),
    )
  })

  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(runOrchestrationTs(c.request)).toEqual(c.answer)
    })
  }

  it('accepts Astrid\'s own policy as a stored override, unchanged', () => {
    expect(parsePolicyOverride(fixture.astridPolicy)).toEqual({ ok: true, value: fixture.astridPolicy })
  })

  it('accepts every override the fixture stores', () => {
    for (const c of fixture.cases) {
      if (c.answer.ok) {
        expect(parsePolicyOverride(c.request.project).ok, c.name).toBe(true)
        expect(parsePolicyOverride(c.request.list).ok, c.name).toBe(true)
      }
    }
  })
})

describe('orchestration.json — the server entry point, whichever engine answers (AWTD-1693)', () => {
  for (const forced of ['typescript', 'vendored'] as const) {
    it(`agrees with every case (${forced})`, () => {
      setOrchestrationCoreForTests(forced === 'typescript' ? null : vendoredCore())
      for (const c of fixture.cases) {
        expect(runOrchestration(c.request), c.name).toEqual(c.answer)
      }
    })
  }
})

describe('orchestration.json — through the vendored core build (AWTD-1693)', () => {
  const core = vendoredCore()

  it('loads and answers the orchestration kinds, so the server asks the core', () => {
    expect(core, 'packages/astrid-rules did not load').not.toBeNull()
    expect(coreAnswersOrchestration(core)).toBe(true)
    setOrchestrationCoreForTests(undefined)
    expect(orchestrationEngine()).toBe('core')
  })

  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(JSON.parse(core!.runJson(JSON.stringify(c.request)))).toEqual(c.answer)
    })
  }
})

describe('stored overrides (AWTD-1693)', () => {
  it('nothing stored is today\'s behaviour: the default policy', () => {
    expect(effectiveOrchestrationPolicy({ project: null, list: null })).toEqual({ ok: true, value: defaultOrchestrationPolicy() })
  })

  it('refuses a value the rules do not know rather than storing it', () => {
    expect(parsePolicyOverride({ autonomy: { deploy: 'sometimes' } })).toEqual({
      ok: false,
      error: { kind: 'badRequest', message: 'unknown variant `sometimes`, expected one of `allowed`, `ask`, `never`' },
    })
    expect(parsePolicyOverride({ autonomy: { merge: 'allowed' }, extra: true }).ok).toBe(false)
    expect(parsePolicyOverride({ escalation: { to: 'people' } }).ok).toBe(false)
    expect(parsePolicyOverride({ routing: { assignTo: '' } }).ok).toBe(false)
    expect(parsePolicyOverride('allowed').ok).toBe(false)
  })

  it('refuses a trade-off threshold outside the vocabulary rather than guessing (ADEV-281)', () => {
    expect(parsePolicyOverride({ tradeoff: { risk: { reviewAt: 'scary' } } })).toEqual({
      ok: false,
      error: { kind: 'badRequest', message: 'unknown variant `scary`, expected one of `low`, `medium`, `high`' },
    })
    expect(parsePolicyOverride({ tradeoff: { guardrail: { refuseAtBreachProbability: 1.5 } } })).toEqual({
      ok: false,
      error: { kind: 'badRequest', message: '1.5 is not a probability between 0 and 1' },
    })
    expect(parsePolicyOverride({ tradeoff: { goalOrder: 'g1' } }).ok).toBe(false)
    expect(parsePolicyOverride({ tradeoff: { weights: {} } }).ok).toBe(false)
    // A stored key that names nothing is still a policy (of the defaults), so it is kept, not dropped.
    expect(parsePolicyOverride({ tradeoff: { risk: {} } })).toEqual({ ok: true, value: { tradeoff: {} } })
    expect(runOrchestrationTs({ kind: 'orchestrationPolicy', project: { tradeoff: {} }, list: null })).toEqual({
      ok: true,
      value: { ...defaultOrchestrationPolicy(), tradeoff: defaultTradeoffPolicy() },
    })
  })

  it('counts a promoteIdea estimate only when both label and confidence are given (ADEV-281)', () => {
    const project = { autonomy: { promoteIdea: 'allowed' } }
    const may = (extra: Record<string, unknown>) =>
      runOrchestrationTs({ kind: 'orchestrationMay', project, list: null, agent: 'claude', action: 'promoteIdea', ...extra })
    expect(may({ label: 'do-now' })).toEqual({ ok: true, value: { decision: 'never', mustAsk: false, reason: 'noEstimate' } })
    expect(may({ label: 'do-now', confidence: 'medium' })).toEqual({ ok: true, value: { decision: 'allowed', mustAsk: false, reason: 'policy' } })
    expect(may({ label: 'maybe', confidence: 'high' }).ok).toBe(false)
  })

  it('stores an override that says nothing as null', () => {
    expect(parsePolicyOverride({})).toEqual({ ok: true, value: null })
    expect(parsePolicyOverride({ routing: {}, autonomy: { migrate: {} } })).toEqual({ ok: true, value: null })
  })

  it('keeps routing null as a value, distinct from inheriting', () => {
    expect(parsePolicyOverride({ routing: { assignTo: null } })).toEqual({ ok: true, value: { routing: { assignTo: null } } })
  })

  it('edits one field at a time and drops the rest back to inherit', () => {
    let override = withAutonomy(null, 'merge', 'allowed')
    expect(override).toEqual({ autonomy: { merge: 'allowed' } })
    override = withAutonomy(override, 'migrateDestructive', 'ask')
    expect(override).toEqual({ autonomy: { merge: 'allowed', migrate: { destructive: 'ask' } } })
    override = withAssignTo(override, 'codex')
    override = withEscalation(override, { to: 'people', userIds: ['u1'] })
    override = withAutonomy(override, 'merge', undefined)
    override = withAutonomy(override, 'migrateDestructive', undefined)
    expect(override).toEqual({ routing: { assignTo: 'codex' }, escalation: { to: 'people', userIds: ['u1'] } })
    override = withAssignTo(withEscalation(override, undefined), undefined)
    expect(override).toBeNull()
  })
})
