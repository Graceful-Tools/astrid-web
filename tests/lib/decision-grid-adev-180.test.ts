import { describe, expect, it } from 'vitest'
import { DECISION_EXAMPLE } from '@/lib/decision-examples'
import { parseDecision } from '@/lib/comment-formats'
import {
  buildNewDecision,
  chosenOption,
  parseGrid,
  recordDecided,
  recordedChoice,
  replaceGrid,
  serializeGrid,
} from '@/lib/decision-grid'

const goals = {
  goals: [
    { id: 'g1', statement: 'Grow IRR', measure: 'IRR', target: '≥ 8%/yr', current: '6.1%' },
    { id: 'g2', statement: 'Keep risk low' },
  ],
  guardrails: [
    { id: 'r1', statement: 'No more than 20% in one position', kind: 'enforced' as const },
    { id: 'r2', statement: 'Break no applicable laws', kind: 'stated' as const },
  ],
}

describe('decision grid (ADEV-180)', () => {
  it('reads the canonical example and writes it back unchanged', () => {
    const found = parseGrid(DECISION_EXAMPLE)!
    expect(found.grid.criteria).toEqual(['Cost', 'Travel', 'Fun'])
    expect(found.grid.options[0]).toEqual({
      name: 'Lisbon',
      cells: [
        { rating: '~', text: '$1,400 a person' },
        { rating: '-', text: '9h door to door' },
        { rating: '++', text: 'top pick in the team survey' },
      ],
    })
    expect(replaceGrid(DECISION_EXAMPLE, found.grid)).toContain(serializeGrid(found.grid))
    expect(parseGrid(serializeGrid(found.grid))!.grid).toEqual(found.grid)
  })

  it('round-trips pipes, backslashes, empty cells and emoji ratings', () => {
    const grid = {
      optionLabel: 'Choice',
      criteria: ['A | B', 'Plain'],
      options: [
        { name: 'x | y', cells: [{ rating: '🟢' as const, text: 'a \\ b | c' }, { rating: null, text: '' }] },
        { name: 'Do nothing', cells: [{ rating: '--' as const, text: '' }, { rating: '+' as const, text: 'ok' }] },
      ],
    }
    expect(parseGrid(serializeGrid(grid))!.grid).toEqual(grid)
  })

  it('never writes a score or total column and keeps the prose around the grid', () => {
    const found = parseGrid(DECISION_EXAMPLE)!
    const edited = replaceGrid(DECISION_EXAMPLE, {
      ...found.grid,
      options: found.grid.options.map((o, i) => (i === 1 ? { ...o, cells: [{ rating: '++' as const, text: 'cheap' }, ...o.cells.slice(1)] } : o)),
    })!
    expect(edited).toContain('| 2. Cabin | ++ cheap |')
    expect(edited.split('\n').filter(l => l.startsWith('|'))[0]).not.toMatch(/score|total/i)
    expect(edited.startsWith(found.before)).toBe(true)
    expect(edited.endsWith(found.after)).toBe(true)
    expect(parseDecision(edited)).not.toBeNull()
  })

  it('ignores a table inside a code fence and a table that is not a grid', () => {
    expect(parseGrid('```\n| a | b |\n|---|---|\n| x | + y |\n```')).toBeNull()
    expect(parseGrid('| a | b |\n|---|---|\n| x | plain |')).toBeNull()
  })

  it('starts a decision from goals: criteria columns, a Do nothing row, guardrails under the grid', () => {
    const d = buildNewDecision({ title: 'Which fund?', goalsAndGuardrails: goals })
    expect(d.criteria.map(c => c.letter)).toEqual(['A', 'B'])
    const decision = parseDecision(d.description)!
    expect(decision.prompt).toBe('Which fund?')
    expect(decision.options.at(-1)!.text).toBe('Do nothing')
    expect(decision.options[0].recommended).toBe(true)
    const found = parseGrid(d.description)!
    expect(found.grid.criteria).toEqual(['Grow IRR', 'Keep risk low'])
    expect(found.grid.options.map(o => o.name).at(-1)).toBe('Do nothing')
    expect(found.after).toContain('(measure: IRR; target: ≥ 8%/yr; current: 6.1%)')
    expect(found.after.indexOf('Guardrails')).toBeGreaterThan(found.after.indexOf('Keep risk low'))
    expect(found.after).toContain('- No more than 20% in one position')
    expect(found.after).toContain('rated -- (Disqualifying)')
  })

  it('uses one Outcome column when the project states no goals', () => {
    const d = buildNewDecision({ goalsAndGuardrails: { goals: [], guardrails: [] } })
    expect(parseGrid(d.description)!.grid.criteria).toEqual(['Outcome'])
    expect(d.description).not.toContain('Guardrails')
  })

  it('records the chosen option from a reply, and keeps the record on the description', () => {
    const d = buildNewDecision({ goalsAndGuardrails: goals }).description
    expect(chosenOption(d, ['looks fine', 'what about cost?'])).toBeNull()
    expect(chosenOption(d, ['2 — Option 2'])).toEqual({ number: 2, text: 'Option 2' })
    const recorded = recordDecided(d, 3)!
    expect(recordedChoice(recorded)).toEqual({ number: 3, text: 'Do nothing' })
    expect(chosenOption(recorded, ['1'])).toEqual({ number: 3, text: 'Do nothing' })
    expect(recordDecided(recorded, 1)!.match(/\*\*Decided:\*\*/g)).toHaveLength(1)
    expect(recordDecided(d, 9)).toBeNull()
    expect(parseDecision(recorded)).not.toBeNull()
  })
})
