/**
 * ADEV-179: a project's goals and guardrails — the one shape web, the agents and every client read.
 */
import { describe, it, expect } from 'vitest'
import {
  EMPTY_GOALS_AND_GUARDRAILS,
  GOALS_MAX,
  GUARDRAILS_MAX,
  STATEMENT_MAX_CHARS,
  formatGoalsForAgent,
  hasGoalsOrGuardrails,
  parseGoalsAndGuardrails,
  storedGoalsAndGuardrails,
} from '@/lib/goals-guardrails'

describe('parseGoalsAndGuardrails (ADEV-179)', () => {
  it('accepts goals with optional measures and guardrails of either kind', () => {
    const r = parseGoalsAndGuardrails({
      goals: [{ id: 'returns', statement: 'Maximise long-term returns', measure: 'IRR', target: '≥ 8%/yr', current: '6.1%' }],
      guardrails: [
        { id: 'law', statement: 'Break no applicable laws', kind: 'stated' },
        { statement: 'No more than 20% in one position', kind: 'enforced' },
      ],
    })
    expect(r).toEqual({
      ok: true,
      value: {
        goals: [{ id: 'returns', statement: 'Maximise long-term returns', measure: 'IRR', target: '≥ 8%/yr', current: '6.1%' }],
        guardrails: [
          { id: 'law', statement: 'Break no applicable laws', kind: 'stated' },
          { id: 'r1', statement: 'No more than 20% in one position', kind: 'enforced' },
        ],
      },
    })
  })

  it('trims, drops empty optional fields, defaults kind to stated, and skips blank statements', () => {
    const r = parseGoalsAndGuardrails({
      goals: [{ statement: '  Ship weekly  ', measure: '  ', target: '' }, { statement: '   ' }],
      guardrails: [{ statement: 'Keep user data private' }],
    })
    expect(r).toEqual({
      ok: true,
      value: {
        goals: [{ id: 'g1', statement: 'Ship weekly' }],
        guardrails: [{ id: 'r1', statement: 'Keep user data private', kind: 'stated' }],
      },
    })
  })

  it('assigns ids that do not collide with ones already given', () => {
    const r = parseGoalsAndGuardrails({ goals: [{ statement: 'A' }, { id: 'g1', statement: 'B' }], guardrails: [] })
    expect(r.ok && r.value.goals.map(g => g.id)).toEqual(['g2', 'g1'])
  })

  it('refuses a duplicate id', () => {
    const r = parseGoalsAndGuardrails({ goals: [{ id: 'x', statement: 'A' }, { id: 'x', statement: 'B' }] })
    expect(r).toEqual({ ok: false, error: 'Goal ids must be unique: x' })
  })

  it('treats null and missing lists as empty', () => {
    expect(parseGoalsAndGuardrails(null)).toEqual({ ok: true, value: EMPTY_GOALS_AND_GUARDRAILS })
    expect(parseGoalsAndGuardrails({})).toEqual({ ok: true, value: EMPTY_GOALS_AND_GUARDRAILS })
  })

  it('refuses the wrong shape, an unknown kind, and too much', () => {
    expect(parseGoalsAndGuardrails('goals').ok).toBe(false)
    expect(parseGoalsAndGuardrails({ goals: 'x' }).ok).toBe(false)
    expect(parseGoalsAndGuardrails({ guardrails: [{ statement: 'x', kind: 'soft' }] })).toEqual({
      ok: false,
      error: 'A guardrail kind is "stated" or "enforced"',
    })
    expect(parseGoalsAndGuardrails({ goals: Array.from({ length: GOALS_MAX + 1 }, (_, i) => ({ statement: `g${i}` })) }).ok).toBe(false)
    expect(parseGoalsAndGuardrails({ guardrails: Array.from({ length: GUARDRAILS_MAX + 1 }, (_, i) => ({ statement: `r${i}` })) }).ok).toBe(false)
    expect(parseGoalsAndGuardrails({ goals: [{ statement: 'x'.repeat(STATEMENT_MAX_CHARS + 1) }] }).ok).toBe(false)
  })
})

describe('storedGoalsAndGuardrails (ADEV-179)', () => {
  it('reads what was stored, and an unreadable value as nothing stated', () => {
    expect(storedGoalsAndGuardrails({ goals: [{ id: 'g1', statement: 'A' }], guardrails: [] })).toEqual({
      goals: [{ id: 'g1', statement: 'A' }],
      guardrails: [],
    })
    expect(storedGoalsAndGuardrails(null)).toEqual(EMPTY_GOALS_AND_GUARDRAILS)
    expect(storedGoalsAndGuardrails({ goals: 7 })).toEqual(EMPTY_GOALS_AND_GUARDRAILS)
  })

  it('hasGoalsOrGuardrails is false only when both lists are empty', () => {
    expect(hasGoalsOrGuardrails(EMPTY_GOALS_AND_GUARDRAILS)).toBe(false)
    expect(hasGoalsOrGuardrails({ goals: [], guardrails: [{ id: 'r1', statement: 'x', kind: 'stated' }] })).toBe(true)
  })
})

describe('formatGoalsForAgent (ADEV-179)', () => {
  it('writes goals with their measures and guardrails with their kind, as markdown', () => {
    const text = formatGoalsForAgent({
      goals: [
        { id: 'returns', statement: 'Maximise long-term returns', measure: 'IRR', target: '≥ 8%/yr', current: '6.1%' },
        { id: 'g2', statement: 'Keep it simple' },
      ],
      guardrails: [
        { id: 'law', statement: 'Break no applicable laws', kind: 'stated' },
        { id: 'r2', statement: 'No more than 20% in one position', kind: 'enforced' },
      ],
    })
    expect(text).toBe(
      [
        '## Goals',
        '- [returns] Maximise long-term returns (measure: IRR; target: ≥ 8%/yr; current: 6.1%)',
        '- [g2] Keep it simple',
        '',
        '## Guardrails',
        '- [law] Break no applicable laws',
        '- [r2] No more than 20% in one position (enforced)',
      ].join('\n'),
    )
  })

  it('omits an empty section, and is empty when nothing is stated', () => {
    expect(formatGoalsForAgent({ goals: [], guardrails: [{ id: 'r1', statement: 'x', kind: 'stated' }] })).toBe('## Guardrails\n- [r1] x')
    expect(formatGoalsForAgent(EMPTY_GOALS_AND_GUARDRAILS)).toBe('')
  })
})
