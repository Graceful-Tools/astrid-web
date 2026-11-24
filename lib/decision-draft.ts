/**
 * A decision being written in task details (ADEV-240; iOS `DecisionDraft.swift`, ADEV-189/231):
 * the question, its options and, if wanted, a trade-off grid rated in traffic-light colours. It
 * becomes ordinary markdown in the docs/DECISIONS.md format, posted as a comment or added to the
 * description. Nothing about a decision is kept anywhere but that text.
 *
 * The markdown matches iOS's `DecisionDraft.markdown` byte for byte; the tests are ported from
 * `DecisionDraftTests.swift`.
 */
import type { Rating } from '@/lib/comment-formats'
import { serializeGrid, type DecisionGrid, type GridCell } from '@/lib/decision-grid'

export interface DraftOption { id: string; text: string }
export interface DraftCriterion {
  id: string
  name: string
  /** What it means, optional (ADEV-231): one line of the key under the grid. */
  detail: string
}

export interface DecisionDraft {
  question: string
  options: DraftOption[]
  /** The option marked `(recommended)`, if any. */
  recommended: string | null
  criteria: DraftCriterion[]
  /** Keyed `${optionId}:${criterionId}`. */
  cells: Record<string, GridCell>
}

export type DecisionDraftProblem = 'noQuestion' | 'tooFewOptions' | 'reasonWithoutRating'

/** The grid's columns, as the guide asks: three to five; one or two are allowed. */
export const MAX_DRAFT_CRITERIA = 5

/** The five traffic lights a composer offers, worst to best. */
export const DRAFT_RATINGS: Rating[] = ['--', '-', '~', '+', '++']

let nextId = 0
export function draftId(prefix: string): string {
  nextId += 1
  return `${prefix}${Date.now().toString(36)}${nextId}`
}

export function emptyDecisionDraft(): DecisionDraft {
  return {
    question: '',
    options: [{ id: draftId('o'), text: '' }, { id: draftId('o'), text: '' }],
    recommended: null,
    criteria: [],
    cells: {},
  }
}

const cellKey = (optionId: string, criterionId: string) => `${optionId}:${criterionId}`

export function draftCell(d: DecisionDraft, optionId: string, criterionId: string): GridCell {
  return d.cells[cellKey(optionId, criterionId)] ?? { rating: null, text: '' }
}

export function setDraftCell(d: DecisionDraft, optionId: string, criterionId: string, cell: GridCell): DecisionDraft {
  return { ...d, cells: { ...d.cells, [cellKey(optionId, criterionId)]: cell } }
}

/** One line: a decision's question, options and cells never span lines. */
function line(text: string): string {
  return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).join(' ')
}

const namedOptions = (d: DecisionDraft) => d.options.filter(o => line(o.text) !== '')
const namedCriteria = (d: DecisionDraft) => d.criteria.filter(c => line(c.name) !== '')

/** Only the cells of options and criteria that are written down. */
function keptCells(d: DecisionDraft): GridCell[] {
  return namedOptions(d).flatMap(o => namedCriteria(d).map(c => draftCell(d, o.id, c.id)))
}

export function decisionDraftProblem(d: DecisionDraft): DecisionDraftProblem | null {
  if (line(d.question) === '') return 'noQuestion'
  if (namedOptions(d).length < 2) return 'tooFewOptions'
  if (keptCells(d).some(c => c.rating === null && line(c.text) !== '')) return 'reasonWithoutRating'
  return null
}

/** A grid only once a cell has a colour; criteria alone add nothing. */
function draftGrid(d: DecisionDraft): DecisionGrid | null {
  const criteria = namedCriteria(d)
  if (criteria.length === 0 || !keptCells(d).some(c => c.rating !== null)) return null
  return {
    optionLabel: 'Option',
    criteria: criteria.map(c => line(c.name)),
    options: namedOptions(d).map(o => ({
      name: line(o.text),
      cells: criteria.map(c => {
        const cell = draftCell(d, o.id, c.id)
        return { rating: cell.rating, text: line(cell.text) }
      }),
    })),
  }
}

export function decisionDraftMarkdown(d: DecisionDraft): string {
  const lines = [`**Decision:** ${line(d.question)}`, '']
  namedOptions(d).forEach((option, i) => {
    const mark = option.id === d.recommended ? ' (recommended)' : ''
    lines.push(`- **${i + 1}.** ${line(option.text)}${mark}`)
  })
  const grid = draftGrid(d)
  if (grid) {
    lines.push('', serializeGrid(grid))
    const key = namedCriteria(d)
      .filter(c => line(c.detail) !== '')
      .map(c => `- **${line(c.name)}:** ${line(c.detail)}`)
    if (key.length) lines.push('', ...key)
  }
  return lines.join('\n')
}

/** `description` with `markdown` after what is already there, a blank line between. */
export function appendDecision(markdown: string, description: string): string {
  return description.trim() === '' ? markdown : `${description.replace(/\s+$/, '')}\n\n${markdown}`
}
