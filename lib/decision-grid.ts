/**
 * Decisions as a process (ADEV-180, step 3 of Understand → Identify → Execute).
 *
 * A decision is a task: it has an id, an assignee, lanes and the agent handoff already, and its
 * description holds the traffic light in the trade-off-grid markdown every client renders
 * (lib/comment-formats.ts). There is no chart table. This module is the one place that:
 *
 * - reads a grid out of markdown and writes it back, losslessly (`parseGrid` ↔ `serializeGrid`),
 *   so an editor can change one cell without touching the prose around it (`replaceGrid`).
 *   The grid never gets a score or total column (ADEV-178): the person decides.
 * - starts a decision from a project's goals and guardrails (`buildNewDecision`): a goal becomes a
 *   criterion column, a "Do nothing" row is always there, and the guardrails sit under the grid.
 * - records what was chosen (`chosenOption`, `recordDecided`).
 *
 * contracts/fixtures/decision-grid.json holds the serialiser's cases so the other clients edit
 * identically. Safe for the browser: no server imports.
 */
import {
  columnLetter,
  chosenNumber,
  parseDecision,
  parseRating,
  rowName,
  isTradeoffGrid,
  type Rating,
} from '@/lib/comment-formats'
import type { GoalsAndGuardrails } from '@/lib/goals-guardrails'
import { goalMeasurePhrase } from '@/lib/goals-guardrails'

export interface GridCell {
  /** The rating token as written, or null for an empty cell. */
  rating: Rating | null
  /** The concrete reason, a number or a duration where there is one. */
  text: string
}

export interface GridOption {
  /** Without its "1." marker: the grid numbers its rows itself. */
  name: string
  /** One cell per criterion. */
  cells: GridCell[]
}

export interface DecisionGrid {
  /** The top-left header, "Option" by default. */
  optionLabel: string
  criteria: string[]
  options: GridOption[]
}

/** The text and the grid's place in it, so an edit leaves the prose around the grid as it was. */
export interface GridInMarkdown {
  grid: DecisionGrid
  /** Lines before the table, and after it, exactly as written. */
  before: string
  after: string
}

const SEPARATOR_CELL = /^:?-{3,}:?$/

function escapeCell(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').trim()
}

/** Split a table row on unescaped pipes, unescaping `\|` and `\\` in each cell. */
function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, '')
  const cells: string[] = []
  let cell = ''
  let ended = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '\\' && (body[i + 1] === '|' || body[i + 1] === '\\')) {
      cell += body[++i]
    } else if (ch === '|') {
      cells.push(cell.trim())
      cell = ''
      ended = i === body.length - 1
    } else {
      cell += ch
      ended = false
    }
  }
  if (!ended) cells.push(cell.trim())
  return cells
}

function cellText(cell: GridCell): string {
  return [cell.rating, cell.text].filter(Boolean).join(' ')
}

/**
 * The grid as markdown: a header, a separator, then one numbered row per option. Criteria and
 * option names are written as given; cells are `<rating> <text>`. No score column, ever.
 */
export function serializeGrid(grid: DecisionGrid): string {
  const width = grid.criteria.length
  const header = [grid.optionLabel || 'Option', ...grid.criteria]
  const lines = [
    `| ${header.map(escapeCell).join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
  ]
  grid.options.forEach((option, i) => {
    const cells = Array.from({ length: width }, (_, c) => option.cells[c] ?? { rating: null, text: '' })
    lines.push(`| ${[`${i + 1}. ${option.name}`, ...cells.map(cellText)].map(escapeCell).join(' | ')} |`)
  })
  return lines.join('\n')
}

/** A grid's cell from its markdown, or null when its text is not a rating. */
function readCell(raw: string): GridCell | null {
  if (raw.trim() === '') return { rating: null, text: '' }
  const parsed = parseRating(raw)
  return parsed ? { rating: parsed.rating, text: parsed.rest } : null
}

/**
 * Find the first trade-off grid in markdown, outside code, and read it. Null when there is none, or
 * when its table is not one (`isTradeoffGrid`).
 */
export function parseGrid(markdown: string): GridInMarkdown | null {
  if (!markdown) return null
  const lines = markdown.split('\n')
  let fence: string | null = null
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]
    const opener = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      if (opener && opener[0] === fence[0] && opener.length >= fence.length && line.trim() === opener) fence = null
      continue
    }
    if (opener) {
      fence = opener
      continue
    }
    if (!line.trim().startsWith('|')) continue
    const separator = lines[i + 1].trim().startsWith('|') ? splitRow(lines[i + 1]) : []
    if (separator.length === 0 || !separator.every(c => SEPARATOR_CELL.test(c))) continue

    let end = i + 2
    while (end < lines.length && lines[end].trim().startsWith('|')) end++
    const header = splitRow(line)
    const bodyRows = lines.slice(i + 2, end).map(splitRow)
    if (header.length < 2 || bodyRows.length === 0) return null
    if (!isTradeoffGrid(bodyRows)) return null

    const options: GridOption[] = []
    for (const row of bodyRows) {
      const cells: GridCell[] = []
      for (let c = 1; c < header.length; c++) {
        const cell = readCell(row[c] ?? '')
        if (!cell) return null
        cells.push(cell)
      }
      options.push({ name: rowName(row[0] ?? ''), cells })
    }
    return {
      grid: { optionLabel: header[0], criteria: header.slice(1), options },
      before: lines.slice(0, i).join('\n'),
      after: lines.slice(end).join('\n'),
    }
  }
  return null
}

/** Put an edited grid back where it was; null when the markdown has no grid to replace. */
export function replaceGrid(markdown: string, grid: DecisionGrid): string | null {
  const found = parseGrid(markdown)
  if (!found) return null
  return [found.before, serializeGrid(grid), found.after].filter(part => part !== '').join('\n')
}

// ── Starting a decision from a project's goals ────────────────────────────

/** The words the starter writes into a decision. Clients may pass their own in the reader's language. */
export interface NewDecisionLabels {
  title: string
  recommendation: string
  optionLabel: string
  outcomeCriterion: string
  option: (n: number) => string
  doNothing: string
  guardrailsHeading: string
  guardrailRule: string
}

export const NEW_DECISION_LABELS: NewDecisionLabels = {
  title: 'Decision',
  recommendation: 'We recommend #1, accepting [the trade-off].',
  optionLabel: 'Option',
  outcomeCriterion: 'Outcome',
  option: n => `Option ${n}`,
  doNothing: 'Do nothing',
  guardrailsHeading: 'Guardrails',
  guardrailRule: 'An option that breaks one is rated -- (Disqualifying).',
}

/** What a new decision is filed with. */
export interface NewDecision {
  title: string
  description: string
  /** The criteria written, in column order (A, B, C…), each with the goal it came from. */
  criteria: Array<{ letter: string; name: string; goalId: string | null }>
}

const CRITERION_NAME_MAX = 60

/** A goal's statement as a short column heading. */
function criterionName(statement: string): string {
  const oneLine = statement.replace(/\s+/g, ' ').trim()
  return oneLine.length > CRITERION_NAME_MAX ? `${oneLine.slice(0, CRITERION_NAME_MAX - 1).trimEnd()}…` : oneLine
}

/**
 * A decision ready to fill in: the recommendation placeholder first, the Decision with two options
 * and "Do nothing" (an honest option, ADEV-178), the grid with the project's goals as criteria and
 * every cell unrated (`~`), a key naming each criterion's goal, and the guardrails under the grid.
 * With no goals stated there is one "Outcome" column.
 */
export function buildNewDecision(args: {
  title?: string
  goalsAndGuardrails: GoalsAndGuardrails
  labels?: Partial<NewDecisionLabels>
}): NewDecision {
  const labels = { ...NEW_DECISION_LABELS, ...args.labels }
  const { goals, guardrails } = args.goalsAndGuardrails
  const title = args.title?.trim() || labels.title

  const criteria = goals.length
    ? goals.map((g, i) => ({ letter: columnLetter(i), name: criterionName(g.statement), goalId: g.id as string | null, goal: g }))
    : [{ letter: columnLetter(0), name: labels.outcomeCriterion, goalId: null as string | null, goal: null }]

  const names = [labels.option(1), labels.option(2), labels.doNothing]
  const grid: DecisionGrid = {
    optionLabel: labels.optionLabel,
    criteria: criteria.map(c => c.name),
    options: names.map(name => ({ name, cells: criteria.map(() => ({ rating: '~' as Rating, text: '' })) })),
  }

  const blocks = [
    labels.recommendation,
    `**Decision:** ${title}`,
    [
      `- **1.** ${names[0]} (recommended)`,
      `- **2.** ${names[1]}`,
      `- **3.** ${names[2]}`,
    ].join('\n'),
    serializeGrid(grid),
    criteria
      .map(c => {
        const measure = c.goal ? goalMeasurePhrase(c.goal) : ''
        return `- **${c.name}:** ${c.goal ? c.goal.statement : labels.outcomeCriterion}${measure ? ` (${measure})` : ''}`
      })
      .join('\n'),
  ]
  if (guardrails.length) {
    blocks.push(
      [`**${labels.guardrailsHeading}:** ${labels.guardrailRule}`, ...guardrails.map(r => `- ${r.statement}`)].join('\n'),
    )
  }

  return {
    title,
    description: blocks.join('\n\n'),
    criteria: criteria.map(({ letter, name, goalId }) => ({ letter, name, goalId })),
  }
}

// ── The decided record ────────────────────────────────────────────────────

export interface ChosenOption {
  number: number
  text: string
}

/** A line of its own at the end of a decision's description once an option was chosen. */
const DECIDED_LINE = /^\*\*Decided:\*\*\s*(\d{1,2})(?:\s+[—-]\s+(.*))?$/m

/** The choice already recorded in the description, or null. */
export function recordedChoice(description: string): ChosenOption | null {
  const m = DECIDED_LINE.exec(description ?? '')
  return m ? { number: Number(m[1]), text: (m[2] ?? '').trim() } : null
}

/**
 * Which option was chosen: the one recorded on the description, else the latest reply (oldest first,
 * as the caller holds them) that picks an option the way a card tap does (`chosenNumber`).
 * Null while the decision is open, or when the description holds no Decision.
 */
export function chosenOption(description: string, replies: string[] = []): ChosenOption | null {
  const decision = parseDecision(description)
  if (!decision) return null
  const recorded = recordedChoice(description)
  const pick = (n: number): ChosenOption | null => {
    const option = decision.options.find(o => o.number === n)
    return option ? { number: option.number, text: option.text } : null
  }
  if (recorded) return pick(recorded.number)
  for (let i = replies.length - 1; i >= 0; i--) {
    const n = chosenNumber(replies[i], decision.options)
    if (n !== null) return pick(n)
  }
  return null
}

/** The description with the choice recorded (replacing an earlier record); null when it holds no such option. */
export function recordDecided(description: string, number: number): string | null {
  const decision = parseDecision(description)
  const option = decision?.options.find(o => o.number === number)
  if (!option) return null
  const line = `**Decided:** ${option.text ? `${option.number} — ${option.text}` : `${option.number}`}`
  const base = DECIDED_LINE.test(description) ? description.replace(DECIDED_LINE, line) : `${description.trimEnd()}\n\n${line}`
  return base
}
