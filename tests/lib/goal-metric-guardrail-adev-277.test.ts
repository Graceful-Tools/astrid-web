/**
 * ADEV-277: a metric guardrail reads a number from an outside source, and a stale or missing reading
 * is unknown, never passing. A pull that confirms the stored value refreshes its time.
 */
import { describe, it, expect } from 'vitest'
import {
  guardrailViolations,
  isReadingFresh,
  parseGoalsAndGuardrails,
  withMeasurement,
  type ProjectGoal,
} from '@/lib/goals-guardrails'
import type { OrchestrationPolicy } from '@/lib/orchestration-autonomy'

const NOW = new Date('2026-11-25T17:00:00Z')
const policy: OrchestrationPolicy = {
  routing: { assignTo: null, agents: null },
  autonomy: { merge: 'allowed', deploy: 'allowed', migrate: { additive: 'allowed', destructive: 'ask' }, release: 'ask', spend: 'ask', promoteIdea: 'never', experimentStart: 'never', experimentStop: 'never' },
  escalation: { to: 'listOwner' },
}
const check = (over: Record<string, unknown> = {}) => ({
  type: 'metric',
  source: { connectorId: 'c1', metricKey: 'error_rate' },
  op: '<=',
  threshold: 2,
  unit: '%',
  ...over,
})
const rail = (c: unknown, kind = 'enforced') => ({ id: 'r1', statement: 'Errors stay low', kind, check: c })

describe('metric guardrail check (ADEV-277)', () => {
  it('parses a metric check and keeps the server-written reading', () => {
    const parsed = parseGoalsAndGuardrails({ goals: [], guardrails: [rail(check({ current: 1.2, measuredAt: '2026-11-25T16:00:00Z', junk: 1 }))] })
    expect(parsed.ok && parsed.value.guardrails[0].check).toEqual({
      type: 'metric',
      source: { connectorId: 'c1', metricKey: 'error_rate' },
      op: '<=',
      threshold: 2,
      unit: '%',
      current: 1.2,
      measuredAt: '2026-11-25T16:00:00Z',
    })
  })

  it('refuses a malformed metric check and a check on a stated guardrail', () => {
    for (const bad of [check({ op: '<' }), check({ threshold: 'two' }), check({ source: {} }), check({ staleAfterHours: 0 })]) {
      expect(parseGoalsAndGuardrails({ guardrails: [rail(bad)] }).ok).toBe(false)
    }
    expect(parseGoalsAndGuardrails({ guardrails: [rail(check(), 'stated')] }).ok).toBe(false)
  })

  it('passes a fresh reading inside the threshold', () => {
    const r = rail(check({ current: 1.5, measuredAt: '2026-11-25T16:00:00Z' }))
    expect(guardrailViolations([r] as never, policy, ['deploy'], NOW)).toEqual([])
  })

  it('is violated by a fresh reading outside the threshold, whatever the action', () => {
    const r = rail(check({ current: 3.4, measuredAt: '2026-11-25T16:00:00Z' }))
    const out = guardrailViolations([r] as never, policy, ['migrateAdditive'], NOW)
    expect(out).toHaveLength(1)
    expect(out[0].reason).toContain('3.4%')
    expect(out[0].reason).toContain('<= 2%')
  })

  it('reads >= the other way', () => {
    const ok = rail(check({ op: '>=', threshold: 95, current: 97, measuredAt: '2026-11-25T16:00:00Z' }))
    const bad = rail(check({ op: '>=', threshold: 95, current: 90, measuredAt: '2026-11-25T16:00:00Z' }))
    expect(guardrailViolations([ok] as never, policy, [], NOW)).toEqual([])
    expect(guardrailViolations([bad] as never, policy, [], NOW)).toHaveLength(1)
  })

  it('treats a missing reading as unknown, never passing', () => {
    const out = guardrailViolations([rail(check())] as never, policy, ['deploy'], NOW)
    expect(out).toHaveLength(1)
    expect(out[0].reason).toContain('unknown')
  })

  it('treats a stale reading as unknown, never passing, even when it was inside the threshold', () => {
    const r = rail(check({ current: 0.5, measuredAt: '2026-11-22T16:00:00Z' }))
    const out = guardrailViolations([r] as never, policy, ['deploy'], NOW)
    expect(out).toHaveLength(1)
    expect(out[0].reason).toContain('stale')
  })

  it('honours the check\'s own staleAfterHours', () => {
    const r = rail(check({ current: 0.5, measuredAt: '2026-11-25T14:00:00Z', staleAfterHours: 2 }))
    expect(guardrailViolations([r] as never, policy, [], NOW)).toHaveLength(1)
    expect(isReadingFresh('2026-11-25T14:00:00Z', 4, NOW)).toBe(true)
    expect(isReadingFresh(undefined, 4, NOW)).toBe(false)
  })

  it('leaves a stated guardrail alone', () => {
    expect(guardrailViolations([{ id: 'r1', statement: 's', kind: 'stated' }], policy, ['deploy'], NOW)).toEqual([])
  })
})

describe('withMeasurement for a pull (ADEV-277)', () => {
  const goal: ProjectGoal = {
    id: 'g1',
    statement: 'Convert',
    current: '6.1%',
    metric: { direction: 'up', unit: '%', current: 6.1, measuredAt: '2026-11-24T16:00:00.000Z' },
    history: [{ value: '6.1%', by: 'c1', at: '2026-11-24T16:00:00.000Z', num: 6.1, source: 'pull' }],
  }

  it('refreshes the reading time, with no history entry, when the source confirms the same value', () => {
    const next = withMeasurement(goal, '6.1%', 'c1', new Date('2026-11-25T16:00:00Z'), undefined, { num: 6.1, source: 'pull' })
    expect(next.metric?.measuredAt).toBe('2026-11-25T16:00:00.000Z')
    expect(next.history).toBe(goal.history)
  })

  it('does not move the time backwards', () => {
    expect(withMeasurement(goal, '6.1%', 'c1', new Date('2026-11-20T16:00:00Z'), undefined, { num: 6.1, source: 'pull' })).toBe(goal)
  })

  it('a human re-entering the same value still records nothing', () => {
    expect(withMeasurement(goal, '6.1%', 'u', new Date('2026-11-25T16:00:00Z'))).toBe(goal)
  })
})
