/**
 * Two markdown shapes comments draw richly (AWTD-1524, web half of AITD-578 / AITD-579):
 * a Decision (cards) and a trade-off grid (coloured table). Reference recogniser on iOS/Mac:
 * astrid-ios Packages/AstridCore/Sources/AstridCore/Decision.swift. Format: docs/PRODUCT_CONTRACT.md §8.
 * Anything that is not exactly one of these shapes stays plain markdown.
 */

export interface DecisionOption {
  /** The marker as the asker wrote it, upper case: "A", or "1". A reply leading with it still chooses. */
  letter: string
  /** Its place in the list, from 1: what the card shows and the reply leads with (AWTD-1533). */
  number: number
  text: string
  recommended: boolean
}

export interface ParsedDecision {
  /** Markdown before the "Decision:" paragraph. */
  before: string
  /** The paragraph text after the bold "Decision:" label. */
  prompt: string
  options: DecisionOption[]
  /** Markdown after the option list. */
  after: string
}

const DECISION_HEAD = /^\*\*Decision:\*\*\s*(.*)$/
// **A.** text | **A)** text | **A:** text | **A**) text | **A**. text — or a number of up to two
// digits in place of the letter, **1.** text (AWTD-1533, as iOS AITD-585).
const OPTION_LINE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\*\*([A-Za-z]|\d{1,2})(?:[.):])?\*\*[.):]?)\s*(.*)$/
const RECOMMENDED = /\s*\(recommended\)\s*$/i

/**
 * Lines that markdown draws as code: inside a ``` or ~~~ fence, or indented four spaces (or a
 * tab). A Decision written there is an example of the format and stays code (AWTD-1531).
 */
function codeLineIndexes(lines: string[]): Set<number> {
  const code = new Set<number>()
  let fence: string | null = null
  lines.forEach((line, i) => {
    if (fence) {
      code.add(i)
      const close = /^(`{3,}|~{3,})\s*$/.exec(line.trim())?.[1]
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = null
      return
    }
    const opener = fenceOpener(line)
    if (opener) {
      fence = opener
      code.add(i)
      return
    }
    // Indented code: four columns (a tab is to the next multiple of four). It cannot interrupt a
    // paragraph, so it needs a blank line or more code above it.
    const prev = i === 0 ? '' : lines[i - 1]
    if (line.trim() !== '' && indentWidth(line) >= 4 && (prev.trim() === '' || code.has(i - 1))) code.add(i)
  })
  return code
}

const LIST_PREFIX = /^\s*(?:[-*+]|\d+[.)])\s+/

/** Leading whitespace in columns, tabs to the next multiple of four. */
function indentWidth(line: string): number {
  let width = 0
  for (const ch of line) {
    if (ch === ' ') width++
    else if (ch === '\t') width += 4 - (width % 4)
    else break
  }
  return width
}

/**
 * The fence a line opens, or null. A fence may open inside a list item (`- ```markdown`), and a
 * backtick fence's info string cannot contain a backtick, so a one-line ```code span``` is not one.
 */
function fenceOpener(line: string): string | null {
  const body = LIST_PREFIX.test(line) ? line.replace(LIST_PREFIX, '') : line
  if (body === line && indentWidth(line) >= 4) return null
  const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(body)
  if (!m) return null
  if (m[1][0] === '`' && m[2].includes('`')) return null
  return m[1]
}

/** Parse a comment body as a Decision, or null when it is not exactly that shape. */
export function parseDecision(content: string): ParsedDecision | null {
  if (!content) return null
  const lines = content.split('\n')
  const code = codeLineIndexes(lines)
  const headIndex = lines.findIndex((line, i) => !code.has(i) && DECISION_HEAD.test(line.trim()))
  if (headIndex < 0) return null

  const head = DECISION_HEAD.exec(lines[headIndex].trim())!
  const promptLines = [head[1]]
  let i = headIndex + 1
  // The paragraph runs to the first blank line or list item.
  while (i < lines.length && lines[i].trim() !== '' && !/^\s*(?:[-*+]|\d+[.)])\s/.test(lines[i])) {
    promptLines.push(lines[i].trim())
    i++
  }
  while (i < lines.length && lines[i].trim() === '') i++

  const options: DecisionOption[] = []
  // Options drawn as code are an example, not answers (AWTD-1531).
  while (i < lines.length && !code.has(i) && /^\s*(?:[-*+]|\d+[.)])\s/.test(lines[i])) {
    const m = OPTION_LINE.exec(lines[i])
    if (!m) return null // every item must start with a bold letter or number
    let text = m[2].trim()
    const recommended = RECOMMENDED.test(text)
    if (recommended) text = text.replace(RECOMMENDED, '').trim()
    options.push({ letter: m[1].toUpperCase(), number: options.length + 1, text, recommended })
    i++
  }
  if (options.length < 2) return null

  return {
    before: lines.slice(0, headIndex).join('\n').trim(),
    prompt: promptLines.join(' ').trim(),
    options,
    after: lines.slice(i).join('\n').trim(),
  }
}

/**
 * The comment a click on a card posts. Options are numbered in order, whatever marker the asker
 * wrote, and the reply leads with the number (AWTD-1533, as iOS AITD-585).
 */
export function decisionReply(option: DecisionOption): string {
  return option.text ? `${option.number} — ${option.text}` : `${option.number}`
}

/**
 * The number of the option a reply picks: the number it starts with, or the marker the asker wrote,
 * alone or followed by a space or punctuation. "2 — Wait", "1. go", "b" and "C — Something else"
 * choose; "Also…", "2nd thoughts" and "10 minutes" (with no tenth option) do not.
 */
export function chosenNumber(reply: string, options: DecisionOption[]): number | null {
  const lead = /^\s*([A-Za-z0-9]+)/.exec(reply ?? '')?.[1]
  if (!lead) return null
  if (/^\d+$/.test(lead)) {
    const n = Number(lead)
    return options.some(o => o.number === n) ? n : null
  }
  return options.find(o => o.letter === lead.toUpperCase())?.number ?? null
}

/** A row's own option marker: "A. ", "2) ", "C: ", or a marker standing alone ("B"). */
const ROW_MARKER = /^\s*(?:[A-Za-z]|\d{1,2})(?:[.):](?:\s+|$)|\s*$)/

/**
 * A grid row's option name without the marker its writer put in front ("A. Lisbon" → "Lisbon");
 * the grid numbers its rows itself, like the cards (AWTD-1533).
 */
export function rowName(text: string): string {
  const m = ROW_MARKER.exec(text)
  return m ? text.slice(m[0].length).trim() : text.trim()
}

/** The letter over a grid's criterion column, from 0: A … Z, then AA, AB, as a spreadsheet does. */
export function columnLetter(index: number): string {
  let name = ''
  for (let i = index; i >= 0; i = Math.floor(i / 26) - 1) name = String.fromCharCode(65 + (i % 26)) + name
  return name
}

export type Rating = '--' | '-' | '~' | '+' | '++' | '🔴' | '🟡' | '🟢'

/**
 * Cell colours (Google Docs palette), as classes defined in app/globals.css. Not Tailwind utilities:
 * lib/ is outside Tailwind's content paths, so `bg-[#…]` written here was never generated (AWTD-1529).
 * `rank` orders the key from worst to best, as iOS draws it.
 */
export const RATING_LABEL_KEYS = ['veryPoor', 'poor', 'mixed', 'good', 'veryGood'] as const
export type RatingLabelKey = (typeof RATING_LABEL_KEYS)[number]
/**
 * Translated words a trade-off grid draws: the rating names, from `tasks.tradeoffRatings.*`, and
 * its full-screen control, from `tasks.tradeoffGrid.fullScreen` (AWTD-1534). Missing ones fall back
 * to English.
 */
export type RatingLabels = Partial<Record<RatingLabelKey | 'fullScreen', string>>

/** Read the grid's words for the reader's locale. */
export function ratingLabels(t: (key: string) => string): RatingLabels {
  return {
    ...Object.fromEntries(RATING_LABEL_KEYS.map(k => [k, t(`tasks.tradeoffRatings.${k}`)])),
    fullScreen: t('tasks.tradeoffGrid.fullScreen'),
  }
}

export const RATING_STYLE: Record<Rating, { className: string; labelKey: RatingLabelKey; label: string; rank: number }> = {
  '--': { className: 'tradeoff-very-poor', labelKey: 'veryPoor', label: 'Very poor', rank: 0 },
  '-': { className: 'tradeoff-poor', labelKey: 'poor', label: 'Poor', rank: 1 },
  '~': { className: 'tradeoff-mixed', labelKey: 'mixed', label: 'Mixed', rank: 2 },
  '+': { className: 'tradeoff-good', labelKey: 'good', label: 'Good', rank: 3 },
  '++': { className: 'tradeoff-very-good', labelKey: 'veryGood', label: 'Very good', rank: 4 },
  '🔴': { className: 'tradeoff-poor', labelKey: 'poor', label: 'Poor', rank: 1 },
  '🟡': { className: 'tradeoff-mixed', labelKey: 'mixed', label: 'Mixed', rank: 2 },
  '🟢': { className: 'tradeoff-good', labelKey: 'good', label: 'Good', rank: 3 },
}

const RATING_TOKEN = /^(--|-|~|\+\+|\+|🔴|🟡|🟢)(?=\s|$)/u

/** Split a leading rating token off a cell's text. */
export function parseRating(cell: string): { rating: Rating; rest: string } | null {
  const text = cell.trim()
  const m = RATING_TOKEN.exec(text)
  if (!m) return null
  return { rating: m[1] as Rating, rest: text.slice(m[1].length).trim() }
}

/**
 * Is this table a trade-off grid? Every non-empty body cell after the first column must carry a
 * rating, at least one must exist, and not every rated cell may be a bare "-".
 */
export function isTradeoffGrid(rows: string[][]): boolean {
  let rated = 0
  let allBareDash = true
  for (const row of rows) {
    for (const cell of row.slice(1)) {
      if (cell.trim() === '') continue
      const r = parseRating(cell)
      if (!r) return false
      rated++
      if (!(r.rating === '-' && r.rest === '')) allBareDash = false
    }
  }
  return rated > 0 && !allBareDash
}
