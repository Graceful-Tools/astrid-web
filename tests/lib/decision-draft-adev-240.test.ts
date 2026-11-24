/**
 * ADEV-240: writing a decision from task details on web, as iOS does (ADEV-189, ADEV-231).
 * Ported from astrid-ios `DecisionDraftTests.swift`: the composer's draft becomes the same markdown,
 * byte for byte, that every app draws (docs/DECISIONS.md).
 */
import { describe, it, expect } from 'vitest'
import {
  appendDecision,
  decisionDraftMarkdown,
  decisionDraftProblem,
  emptyDecisionDraft,
  setDraftCell,
  type DecisionDraft,
} from '@/lib/decision-draft'
import { parseDecision } from '@/lib/comment-formats'
import { parseGrid } from '@/lib/decision-grid'

function draft(question: string, options: string[]): DecisionDraft {
  const d = emptyDecisionDraft()
  return { ...d, question, options: options.map((text, i) => ({ id: `o${i}`, text })) }
}

function withCriteria(d: DecisionDraft, names: string[]): DecisionDraft {
  return { ...d, criteria: names.map((name, i) => ({ id: `c${i}`, name, detail: '' })) }
}

describe('a decision written from task details (ADEV-240, iOS ADEV-189)', () => {
  it('a question and options write the decision format', () => {
    const d = { ...draft('Ship today?', ['Ship today', 'Wait for the review']), recommended: 'o0' }
    expect(decisionDraftMarkdown(d)).toBe(
      '**Decision:** Ship today?\n\n- **1.** Ship today (recommended)\n- **2.** Wait for the review',
    )
  })

  it('blank options are left out and the rest renumbered', () => {
    expect(decisionDraftMarkdown(draft('Where?', ['Lisbon', '  ', 'Cabin']))).toMatch(/- \*\*1\.\*\* Lisbon\n- \*\*2\.\*\* Cabin$/)
  })

  it('rated criteria add the trade-off grid', () => {
    let d = withCriteria(draft('Where?', ['Lisbon', 'Cabin']), ['Cost', 'Fun'])
    d = setDraftCell(d, 'o0', 'c0', { rating: '~', text: 'flights' })
    d = setDraftCell(d, 'o0', 'c1', { rating: '++', text: 'sun' })
    d = setDraftCell(d, 'o1', 'c0', { rating: '+', text: '' })
    expect(decisionDraftMarkdown(d).endsWith(
      '- **2.** Cabin\n\n| Option | Cost | Fun |\n|---|---|---|\n| 1. Lisbon | ~ flights | ++ sun |\n| 2. Cabin | + |  |',
    )).toBe(true)
  })

  it('what the composer writes is what the apps draw: a decision and a grid, one row per option', () => {
    let d = { ...withCriteria(draft('Where?', ['Lisbon', 'Cabin']), ['Cost']), recommended: 'o1' }
    d = setDraftCell(d, 'o0', 'c0', { rating: '--', text: 'dear' })
    d = setDraftCell(d, 'o1', 'c0', { rating: '++', text: 'cheap | quiet' })
    const decision = parseDecision(decisionDraftMarkdown(d))
    expect(decision?.options.map(o => o.recommended)).toEqual([false, true])
    const grid = parseGrid(decision!.after)?.grid
    expect(grid?.options.map(o => o.cells.map(c => c.rating))).toEqual([['--'], ['++']])
    expect(grid?.options[1].cells[0].text).toBe('cheap | quiet')
    // One row per option, so web draws it as the grid alone (ADEV-230).
    expect(grid?.options.length).toBe(decision?.options.length)
  })

  it('criteria with no ratings add no grid', () => {
    expect(decisionDraftMarkdown(withCriteria(draft('Where?', ['Lisbon', 'Cabin']), ['Cost']))).not.toContain('|')
  })

  it('what stops it being posted', () => {
    expect(decisionDraftProblem(draft(' ', ['A', 'B']))).toBe('noQuestion')
    expect(decisionDraftProblem(draft('Which?', ['A', '']))).toBe('tooFewOptions')
    let d = draft('Which?', ['A', 'B'])
    expect(decisionDraftProblem(d)).toBeNull()
    d = setDraftCell(withCriteria(d, ['Cost']), 'o0', 'c0', { rating: null, text: 'cheap' })
    expect(decisionDraftProblem(d)).toBe('reasonWithoutRating')
  })

  it('a line break in an option stays on its line', () => {
    const md = decisionDraftMarkdown(draft('Which\nway?', ['Left\nturn', 'Right']))
    expect(md.startsWith('**Decision:** Which way?')).toBe(true)
    expect(md).toContain('- **1.** Left turn\n')
  })

  it('added to a description after what is there', () => {
    const md = decisionDraftMarkdown(draft('Which?', ['A', 'B']))
    expect(appendDecision(md, '')).toBe(md)
    expect(appendDecision(md, 'Notes.\n\n')).toBe(`Notes.\n\n${md}`)
  })
})

describe("a criterion's meaning is the key under the grid (ADEV-240, iOS ADEV-231)", () => {
  function rated(): DecisionDraft {
    const d = withCriteria(draft('Where?', ['Lisbon', 'Cabin']), ['Cost', 'Fun'])
    return setDraftCell(d, 'o0', 'c0', { rating: '+', text: 'cheap flights' })
  }

  it('writes the meaning as the key', () => {
    const d = rated()
    d.criteria[0] = { ...d.criteria[0], detail: 'what the company pays,\nall in' }
    expect(decisionDraftMarkdown(d).endsWith('| 2. Cabin |  |  |\n\n- **Cost:** what the company pays, all in')).toBe(true)
  })

  it('no meanings, no key', () => {
    expect(decisionDraftMarkdown(rated()).endsWith('| 2. Cabin |  |  |')).toBe(true)
  })

  it('no grid, no key', () => {
    let d = rated()
    d = setDraftCell(d, 'o0', 'c0', { rating: null, text: '' })
    d.criteria[0] = { ...d.criteria[0], detail: 'what the company pays' }
    expect(decisionDraftMarkdown(d)).not.toContain('Cost')
  })
})
