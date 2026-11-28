/**
 * ADEV-359: a goal can say when its target should be hit.
 */
import { describe, it, expect } from 'vitest'
import { goalMeasurePhrase, parseGoalsAndGuardrails } from '@/lib/goals-guardrails'

describe('goal targetDate (ADEV-359)', () => {
  it('keeps a YYYY-MM-DD target date on the goal', () => {
    const r = parseGoalsAndGuardrails({ goals: [{ statement: 'Ship', target: '0', targetDate: '2026-12-31' }] })
    expect(r).toMatchObject({ ok: true, value: { goals: [{ statement: 'Ship', targetDate: '2026-12-31' }] } })
  })

  it('refuses a target date that is not a date', () => {
    const r = parseGoalsAndGuardrails({ goals: [{ statement: 'Ship', targetDate: 'soon' }] })
    expect(r.ok).toBe(false)
  })

  it('drops an empty target date', () => {
    const r = parseGoalsAndGuardrails({ goals: [{ statement: 'Ship', targetDate: '' }] })
    expect(r.ok && r.value.goals[0]).not.toHaveProperty('targetDate')
  })

  it('says the date in the measure phrase agents read', () => {
    expect(goalMeasurePhrase({ id: 'g1', statement: 'Ship', target: '0', targetDate: '2026-12-31' })).toBe('target: 0; by: 2026-12-31')
  })
})
