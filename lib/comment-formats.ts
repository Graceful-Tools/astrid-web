/**
 * Two markdown shapes comments draw richly (AWTD-1524, web half of AITD-578 / AITD-579):
 * a Decision (cards) and a trade-off grid (coloured table). Reference recogniser on iOS/Mac:
 * astrid-ios Packages/AstridCore/Sources/AstridCore/Decision.swift. Format: docs/PRODUCT_CONTRACT.md §8.
 * Anything that is not exactly one of these shapes stays plain markdown.
 */

export interface DecisionOption {
  letter: string
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
// **A.** text | **A)** text | **A:** text | **A**) text | **A**. text
const OPTION_LINE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\*\*([A-Za-z])(?:[.):])?\*\*[.):]?)\s*(.*)$/
const RECOMMENDED = /\s*\(recommended\)\s*$/i

/** Parse a comment body as a Decision, or null when it is not exactly that shape. */
export function parseDecision(content: string): ParsedDecision | null {
  if (!content) return null
  const lines = content.split('\n')
  const headIndex = lines.findIndex(line => DECISION_HEAD.test(line.trim()))
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
  while (i < lines.length && /^\s*(?:[-*+]|\d+[.)])\s/.test(lines[i])) {
    const m = OPTION_LINE.exec(lines[i])
    if (!m) return null // every item must start with a bold letter
    let text = m[2].trim()
    const recommended = RECOMMENDED.test(text)
    if (recommended) text = text.replace(RECOMMENDED, '').trim()
    options.push({ letter: m[1].toUpperCase(), text, recommended })
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

/** The comment a click on a card posts. */
export function decisionReply(option: DecisionOption): string {
  return `${option.letter} — ${option.text}`
}

/** The option letter a reply chooses: a letter followed by end, whitespace or punctuation. */
export function chosenLetter(reply: string): string | null {
  const m = /^\s*([A-Za-z])(?=$|[\s.,:;)\]!?—–-])/.exec(reply ?? '')
  return m ? m[1].toUpperCase() : null
}

export type Rating = '--' | '-' | '~' | '+' | '++' | '🔴' | '🟡' | '🟢'

/**
 * Cell colours (Google Docs palette), as classes defined in app/globals.css. Not Tailwind utilities:
 * lib/ is outside Tailwind's content paths, so `bg-[#…]` written here was never generated (AWTD-1529).
 * `rank` orders the key from worst to best, as iOS draws it.
 */
export const RATING_STYLE: Record<Rating, { className: string; label: string; rank: number }> = {
  '--': { className: 'tradeoff-very-poor', label: 'Very poor', rank: 0 },
  '-': { className: 'tradeoff-poor', label: 'Poor', rank: 1 },
  '~': { className: 'tradeoff-mixed', label: 'Mixed', rank: 2 },
  '+': { className: 'tradeoff-good', label: 'Good', rank: 3 },
  '++': { className: 'tradeoff-very-good', label: 'Very good', rank: 4 },
  '🔴': { className: 'tradeoff-poor', label: 'Poor', rank: 1 },
  '🟡': { className: 'tradeoff-mixed', label: 'Mixed', rank: 2 },
  '🟢': { className: 'tradeoff-good', label: 'Good', rank: 3 },
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
