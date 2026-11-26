/**
 * ADEV-182: goals report what served them and keep a measurement history; enforced guardrails are
 * checked by a program and block the action they forbid.
 */
import { describe, it, expect } from 'vitest'
import {
  GOAL_HISTORY_MAX,
  goalIdsServed,
  goalProgress,
  guardrailViolations,
  parseGoalsAndGuardrails,
  withMeasurement,
  type ProjectGoal,
} from '@/lib/goals-guardrails'
import { guardrailHold, deployVerdict } from '@/scripts/lib/land-and-deploy'
import type { OrchestrationPolicy } from '@/lib/orchestration-autonomy'

const policy = (over: Partial<OrchestrationPolicy['autonomy']> = {}): OrchestrationPolicy => ({
  routing: { assignTo: null, agents: null },
  autonomy: { merge: 'allowed', deploy: 'allowed', migrate: { additive: 'allowed', destructive: 'ask' }, release: 'ask', spend: 'ask', promoteIdea: 'never', experimentStart: 'never', experimentStop: 'never', ...over },
  escalation: { to: 'listOwner' },
})

const rail = (check: unknown, kind = 'enforced') => ({ id: 'r1', statement: 'No unattended deploys', kind, check })

describe('goal measurement history (ADEV-182)', () => {
  const goal = { id: 'g1', statement: 'Grow', target: '10', current: '4' }

  it('records who, when and the task when the value changes', () => {
    const next = withMeasurement(goal, '6', 'claude-agent', new Date('2026-11-21T10:00:00Z'), 'ADEV-182')
    expect(next.current).toBe('6')
    expect(next.history).toEqual([{ value: '6', by: 'claude-agent', at: '2026-11-21T10:00:00.000Z', taskId: 'ADEV-182' }])
  })

  it('records nothing for an unchanged or blank value', () => {
    expect(withMeasurement(goal, '4', 'u', new Date())).toBe(goal)
    expect(withMeasurement(goal, '  ', 'u', new Date())).toBe(goal)
  })

  it('keeps only the latest entries', () => {
    let g: ProjectGoal = goal
    for (let i = 0; i < GOAL_HISTORY_MAX + 5; i++) g = withMeasurement(g, String(100 + i), 'u', new Date())
    expect(g.history).toHaveLength(GOAL_HISTORY_MAX)
  })

  it('round-trips through the parser and refuses a malformed history', () => {
    const stored = withMeasurement(goal, '6', 'u', new Date('2026-11-21T10:00:00Z'))
    const ok = parseGoalsAndGuardrails({ goals: [stored], guardrails: [] })
    expect(ok.ok && ok.value.goals[0].history).toHaveLength(1)
    expect(parseGoalsAndGuardrails({ goals: [{ ...goal, history: [{ value: 'x' }] }] }).ok).toBe(false)
  })
})

describe('goalProgress (ADEV-182)', () => {
  it('is a percentage of a numeric target, capped at 100, and met at or above it', () => {
    expect(goalProgress({ target: '≥ 8%/yr', current: '6.1%' })).toEqual({ met: false, percent: 76 })
    expect(goalProgress({ target: '10', current: '12' })).toEqual({ met: true, percent: 100 })
  })
  it('treats a ≤ target as met at or below it', () => {
    expect(goalProgress({ target: '≤ 5', current: '3' })).toEqual({ met: true, percent: null })
    expect(goalProgress({ target: '≤ 5', current: '7' })).toEqual({ met: false, percent: null })
  })
  it('has no progress for prose', () => {
    expect(goalProgress({ target: 'ship it', current: '6' })).toBeNull()
    expect(goalProgress({ target: '10' })).toBeNull()
  })
})

describe('goalIdsServed (ADEV-182)', () => {
  it('reads GOAL lines from a report', () => {
    expect(goalIdsServed('Fixed it.\nGOAL: g1, [g2]\nAWAITING-DEPLOY: abc')).toEqual(['g1', 'g2'])
  })
  it('ignores a GOAL mention inside a sentence', () => {
    expect(goalIdsServed('This serves GOAL: g1 somehow')).toEqual([])
  })
})

describe('enforced guardrail checks (ADEV-182)', () => {
  const check = { type: 'policy', field: 'deploy', atLeast: 'ask' }

  it('parses a policy check only on an enforced guardrail', () => {
    const ok = parseGoalsAndGuardrails({ guardrails: [rail(check)] })
    expect(ok.ok && ok.value.guardrails[0].check).toEqual(check)
    expect(parseGoalsAndGuardrails({ guardrails: [rail(check, 'stated')] }).ok).toBe(false)
    expect(parseGoalsAndGuardrails({ guardrails: [rail({ type: 'policy', field: 'nope', atLeast: 'ask' })] }).ok).toBe(false)
    expect(parseGoalsAndGuardrails({ guardrails: [rail({ type: 'policy', field: 'deploy', atLeast: 'allowed' })] }).ok).toBe(false)
  })

  const rails = [{ id: 'r1', statement: 'No unattended deploys', kind: 'enforced' as const, check: check as never }]

  it('is violated when the policy lets agents act more freely than the guardrail allows', () => {
    expect(guardrailViolations(rails, policy(), ['deploy'])).toHaveLength(1)
    expect(guardrailViolations(rails, policy({ deploy: 'ask' }), ['deploy'])).toEqual([])
    expect(guardrailViolations(rails, policy({ deploy: 'never' }), ['deploy'])).toEqual([])
  })

  it('only checks the fields of the action, and never a stated guardrail', () => {
    expect(guardrailViolations(rails, policy(), ['merge'])).toEqual([])
    expect(guardrailViolations([{ ...rails[0], kind: 'stated' }], policy(), ['deploy'])).toEqual([])
  })

  it('blocks the deploy and names the guardrail', () => {
    expect(guardrailHold(rails, policy(), ['deploy'])).toContain('"No unattended deploys" [r1]')
    const verdict = deployVerdict({ landedOrAlreadyOnMain: true, pending: [], predeployGreen: true, policy: policy(), guardrails: rails })
    expect(verdict.deploy).toBe(false)
    expect(!verdict.deploy && verdict.reason).toContain('enforced guardrail violated')
    expect(deployVerdict({ landedOrAlreadyOnMain: true, pending: [], predeployGreen: true, policy: policy({ deploy: 'never' }), guardrails: rails }).deploy).toBe(false)
    expect(deployVerdict({ landedOrAlreadyOnMain: true, pending: [], predeployGreen: true, policy: policy() }).deploy).toBe(true)
  })
})
