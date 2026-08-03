/**
 * Search query parsing (task 5df85b9f).
 *
 * Turns `assignee:me priority:high overdue rollover` into a structured filter
 * plus the free-text terms.
 *
 * The filter keys map onto the **existing virtual-list filter vocabulary**
 * (`filterAssignee`, `filterPriority`, `filterDueDate`, …) rather than
 * inventing a second one, so there is exactly one way to express "high
 * priority tasks assigned to me" in the product.
 *
 * Unknown keys degrade to free text rather than erroring: a search box must
 * never punish a typo. Someone typing `hostname:foo` is searching for
 * "hostname:foo", not making a mistake we should shout about.
 */

export type SearchPriority = 'none' | 'low' | 'medium' | 'high'
export type SearchDue = 'today' | 'overdue' | 'week' | 'month' | 'none'
export type SearchState = 'open' | 'done' | 'canceled'

/** Board status. 'none' means Inbox — statusRole IS NULL. */
export type SearchStatus = string

export interface ParsedSearchQuery {
  /** Free-text terms, joined for full-text search. */
  text: string
  /** "me" or a @handle/email; null when unfiltered. */
  assignee: string | null
  listNames: string[]
  labelNames: string[]
  priorities: SearchPriority[]
  due: SearchDue | null
  state: SearchState | null
  /**
   * Board statuses (AWTD-567). Cheap now that status is a field on the task
   * rather than a list membership — and it is what makes "Ready across every
   * project" a real query, which is the cross-project state view the list
   * model could never express.
   */
  statuses: SearchStatus[]
  /** Bare identifier (AST-142) if the query is one — a direct hit. */
  identifier: string | null
}

const PRIORITY_ALIASES: Record<string, SearchPriority> = {
  none: 'none',
  '0': 'none',
  low: 'low',
  '1': 'low',
  medium: 'medium',
  med: 'medium',
  '2': 'medium',
  high: 'high',
  '3': 'high',
  urgent: 'high',
}

const DUE_ALIASES: Record<string, SearchDue> = {
  today: 'today',
  overdue: 'overdue',
  late: 'overdue',
  week: 'week',
  'this-week': 'week',
  month: 'month',
  'this-month': 'month',
  none: 'none',
  never: 'none',
}

const STATE_ALIASES: Record<string, SearchState> = {
  open: 'open',
  incomplete: 'open',
  done: 'done',
  complete: 'done',
  completed: 'done',
  canceled: 'canceled',
  cancelled: 'canceled',
}

/** Numeric priority values as stored on Task. */
export function priorityToNumber(priority: SearchPriority): number {
  switch (priority) {
    case 'high': return 3
    case 'medium': return 2
    case 'low': return 1
    default: return 0
  }
}

const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9]{1,4}-\d+$/

/**
 * Split on whitespace while respecting double quotes, so
 * `list:"Bugs and Polish"` survives as one token.
 */
function tokenize(query: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuotes = false

  for (const char of query) {
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && /\s/.test(char)) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

export function parseSearchQuery(query: string): ParsedSearchQuery {
  const result: ParsedSearchQuery = {
    text: '',
    assignee: null,
    listNames: [],
    labelNames: [],
    priorities: [],
    due: null,
    state: null,
    statuses: [],
    identifier: null,
  }

  const textParts: string[] = []

  for (const token of tokenize(query || '')) {
    // A bare identifier is a direct hit, not a search term.
    if (IDENTIFIER_RE.test(token)) {
      result.identifier = token.toUpperCase()
      continue
    }

    const separator = token.indexOf(':')
    if (separator <= 0 || separator === token.length - 1) {
      // `is:` with no value, a bare word, or a leading colon — all free text.
      if (token) textParts.push(token)
      continue
    }

    const key = token.slice(0, separator).toLowerCase()
    const value = token.slice(separator + 1)
    const normalized = value.toLowerCase()

    switch (key) {
      case 'assignee':
      case 'owner':
        result.assignee = normalized === 'me' ? 'me' : value.replace(/^@/, '')
        break
      case 'list':
        result.listNames.push(value)
        break
      case 'label':
      case 'tag':
        result.labelNames.push(value)
        break
      case 'priority':
      case 'p': {
        const priority = PRIORITY_ALIASES[normalized]
        if (priority) result.priorities.push(priority)
        else textParts.push(token)
        break
      }
      case 'due': {
        const due = DUE_ALIASES[normalized]
        if (due) result.due = due
        else textParts.push(token)
        break
      }
      case 'status': {
        // Any non-empty value is accepted: a project's custom states are
        // configurable, so the parser cannot know the full set. An unmatched
        // status simply returns nothing rather than erroring.
        if (normalized) result.statuses.push(normalized)
        else textParts.push(token)
        break
      }
      case 'is': {
        const state = STATE_ALIASES[normalized]
        if (state) result.state = state
        else textParts.push(token)
        break
      }
      default:
        // Unknown key: treat the whole token as text rather than erroring.
        textParts.push(token)
    }
  }

  result.text = textParts.join(' ').trim()
  return result
}

/**
 * Does this query ask for anything at all?
 *
 * Used to short-circuit: an empty query should return nothing rather than
 * every task the user can see.
 */
export function isEmptySearch(parsed: ParsedSearchQuery): boolean {
  return (
    !parsed.text &&
    !parsed.assignee &&
    !parsed.identifier &&
    !parsed.due &&
    !parsed.state &&
    parsed.listNames.length === 0 &&
    parsed.labelNames.length === 0 &&
    parsed.priorities.length === 0 &&
    parsed.statuses.length === 0
  )
}

/**
 * Build a Postgres `plainto_tsquery`-safe term string.
 *
 * We deliberately do not expose tsquery operators to users: `&`, `|` and `!`
 * in a search box are far more likely to be literal text than boolean intent.
 */
export function toTextSearchTerms(text: string): string {
  return text.replace(/[&|!():*']/g, ' ').replace(/\s+/g, ' ').trim()
}
