/**
 * ADEV-188 (UI half of ADEV-180): the grid editor reads a decision task's description, edits its
 * criteria, options and cells (a rating plus text, never a score column) and writes it back with
 * the prose around it untouched. When the Decision's options are the grid's rows, renaming, adding
 * or removing an option rewrites the Decision list too, so the grid stays the choice.
 */
import { describe, it, expect } from 'vitest'
import { parseDecision, replaceDecisionOptions } from '@/lib/comment-formats'
import { applyDecisionEdit, editableDecision, gridEditProblem, parseGrid, type DecisionGrid } from '@/lib/decision-grid'

const DESCRIPTION = [
  'We recommend Lisbon (#1), accepting a long travel day.',
  '',
  '**Decision:** Where should we hold the offsite?',
  '',
  '- **1.** Lisbon (recommended)',
  '- **2.** Cabin',
  '- **3.** Do nothing',
  '',
  '| Option | Cost | Travel |',
  '|---|---|---|',
  '| 1. Lisbon | ~ $1,400 | - 9h |',
  '| 2. Cabin | + $600 | + 3h |',
  '| 3. Do nothing | + $0 | + none |',
  '',
  '- **Cost:** per person.',
].join('\n')

describe('ADEV-188 replaceDecisionOptions', () => {
  it('rewrites only the option list', () => {
    const next = replaceDecisionOptions(DESCRIPTION, [
      { text: 'Porto', recommended: false },
      { text: 'Cabin', recommended: true },
    ])!
    expect(next).toContain('- **1.** Porto\n- **2.** Cabin (recommended)\n\n| Option')
    expect(next.startsWith('We recommend Lisbon')).toBe(true)
    expect(parseDecision(next)!.prompt).toBe('Where should we hold the offsite?')
  })

  it('is null without a Decision', () => {
    expect(replaceDecisionOptions('Just prose', [{ text: 'a', recommended: false }])).toBeNull()
  })
})

describe('ADEV-188 editableDecision', () => {
  it('reads the grid, the recommended row and whether the options are the rows', () => {
    const e = editableDecision(DESCRIPTION)!
    expect(e.grid.criteria).toEqual(['Cost', 'Travel'])
    expect(e.grid.options.map(o => o.name)).toEqual(['Lisbon', 'Cabin', 'Do nothing'])
    expect(e.recommended).toBe(0)
    expect(e.optionsAreRows).toBe(true)
  })

  it('is null without a Decision or without a grid', () => {
    expect(editableDecision('**Decision:** x\n\n- **1.** a\n- **2.** b')).toBeNull()
    expect(editableDecision('| Option | Cost |\n|---|---|\n| 1. a | + ok |')).toBeNull()
  })

  it('does not sync the options when the grid has a different row count', () => {
    const short = DESCRIPTION.replace('| 3. Do nothing | + $0 | + none |\n', '')
    expect(editableDecision(short)!.optionsAreRows).toBe(false)
  })
})

describe('ADEV-188 applyDecisionEdit', () => {
  const edited = (): DecisionGrid => {
    const grid = structuredClone(editableDecision(DESCRIPTION)!.grid)
    grid.criteria.push('Fun')
    grid.options.forEach(o => o.cells.push({ rating: '+', text: 'good' }))
    grid.options[1].name = 'Mountain cabin'
    grid.options[1].cells[0] = { rating: '++', text: '$400' }
    return grid
  }

  it('writes the grid back in place and keeps the prose around it', () => {
    const next = applyDecisionEdit(DESCRIPTION, edited(), 0)!
    const grid = parseGrid(next)!.grid
    expect(grid.criteria).toEqual(['Cost', 'Travel', 'Fun'])
    expect(grid.options[1]).toEqual({ name: 'Mountain cabin', cells: [{ rating: '++', text: '$400' }, { rating: '+', text: '3h' }, { rating: '+', text: 'good' }] })
    expect(next.startsWith('We recommend Lisbon')).toBe(true)
    expect(next.endsWith('- **Cost:** per person.')).toBe(true)
    expect(next).not.toMatch(/score|total/i)
  })

  it('renames the Decision option with its row, and moves the star', () => {
    const next = applyDecisionEdit(DESCRIPTION, edited(), 1)!
    const d = parseDecision(next)!
    expect(d.options.map(o => o.text)).toEqual(['Lisbon', 'Mountain cabin', 'Do nothing'])
    expect(d.options.map(o => o.recommended)).toEqual([false, true, false])
  })

  it('adds and removes Decision options with their rows', () => {
    const grid = edited()
    grid.options.splice(0, 1)
    grid.options.push({ name: 'Porto', cells: [{ rating: '~', text: '' }, { rating: '~', text: '' }, { rating: '~', text: '' }] })
    const d = parseDecision(applyDecisionEdit(DESCRIPTION, grid, null)!)!
    expect(d.options.map(o => o.text)).toEqual(['Mountain cabin', 'Do nothing', 'Porto'])
  })

  it('leaves the Decision list alone when it was not the rows', () => {
    const short = DESCRIPTION.replace('| 3. Do nothing | + $0 | + none |\n', '')
    const grid = structuredClone(editableDecision(short)!.grid)
    grid.options[0].name = 'Porto'
    const next = applyDecisionEdit(short, grid, null)!
    expect(parseDecision(next)!.options.map(o => o.text)).toEqual(['Lisbon', 'Cabin', 'Do nothing'])
    expect(parseGrid(next)!.grid.options[0].name).toBe('Porto')
  })
})

describe('ADEV-188 gridEditProblem', () => {
  const base = () => structuredClone(editableDecision(DESCRIPTION)!.grid)

  it('accepts the grid as read', () => {
    expect(gridEditProblem(base())).toBeNull()
  })

  it('needs two named options and one to five named criteria', () => {
    const one = base(); one.options.splice(1)
    expect(gridEditProblem(one)).toBe('tooFewOptions')
    const unnamed = base(); unnamed.options[0].name = ' '
    expect(gridEditProblem(unnamed)).toBe('unnamed')
    const noCriteria = base(); noCriteria.criteria = []; noCriteria.options.forEach(o => { o.cells = [] })
    expect(gridEditProblem(noCriteria)).toBe('noCriteria')
    const blankCriterion = base(); blankCriterion.criteria[1] = ''
    expect(gridEditProblem(blankCriterion)).toBe('unnamed')
  })

  it('refuses a reason with no rating, which would stop the table reading as a grid', () => {
    const g = base(); g.options[0].cells[0] = { rating: null, text: 'unsure' }
    expect(gridEditProblem(g)).toBe('reasonWithoutRating')
  })

  it('needs at least one rating', () => {
    const g = base(); g.options.forEach(o => { o.cells = o.cells.map(() => ({ rating: null, text: '' })) })
    expect(gridEditProblem(g)).toBe('noRating')
  })
})
