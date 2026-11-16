// @vitest-environment node
/**
 * AWTD-1693 — the orchestration policy, held to astrid-core's own fixture.
 *
 * tests/fixtures/core/orchestration.json is astrid-core's contracts/fixtures/orchestration.json
 * (core-first, AWTD-1685), copied byte for byte at core f2cd4e5c (unchanged at adef809). It lives
 * here rather than in packages/astrid-rules/fixtures/ because that directory holds the fixtures at
 * the pinned REVISION (654e004), which predates the rules. When the pin moves (ADEV-23), add
 * `orchestration` to scripts/build-astrid-rules.sh and read it from there.
 *
 * Every case is replayed against:
 * - the TypeScript mirror (lib/orchestration-policy.ts), which the server falls back to and which
 *   validates writes;
 * - the server's entry point (lib/core-rules/orchestration-core.ts), whichever engine it picks;
 * - the vendored core build, once it carries the rules. Until then a tripwire pins the reason, so
 *   moving the pin turns the core half on deliberately rather than silently.
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

const fixture = JSON.parse(
  readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'core', 'orchestration.json'), 'utf8'),
) as { astridPolicy: unknown; cases: Case[] }

const PACKAGE_DIR = process.env.ASTRID_RULES_DIR ?? path.join(process.cwd(), 'packages', 'astrid-rules')

function vendoredCore(): CoreRules | null {
  try {
    return loadCoreRulesFrom(PACKAGE_DIR)
  } catch {
    return null
  }
}

afterEach(() => setOrchestrationCoreForTests(undefined))

describe('orchestration.json — the TypeScript mirror (AWTD-1693)', () => {
  it('has the core\'s 28 cases, every kind among them', () => {
    expect(fixture.cases).toHaveLength(28)
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
  const answers = coreAnswersOrchestration(core)

  it.runIf(answers)('decides every case itself and agrees with the fixture', () => {
    setOrchestrationCoreForTests(core)
    expect(orchestrationEngine()).toBe('core')
    for (const c of fixture.cases) {
      const reply = JSON.parse(core!.runJson(JSON.stringify(c.request)))
      expect(reply, c.name).toEqual(c.answer)
    }
  })

  // Tripwire. When this fails, the pin has moved past core f2cd4e5c: delete this test, and the one
  // above now runs against the build production uses.
  it.skipIf(answers)('the vendored build predates the rules, so the mirror answers (pin 654e004; ADEV-23 moves it)', () => {
    expect(readFileSync(path.join(PACKAGE_DIR, 'REVISION'), 'utf8').trim()).toMatch(/^654e004/)
    setOrchestrationCoreForTests(core)
    expect(orchestrationEngine()).toBe('typescript')
  })
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
