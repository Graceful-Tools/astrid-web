/**
 * Search query types and helpers (task 5df85b9f).
 *
 * `assignee:me priority:high overdue rollover` becomes a structured filter plus the free-text
 * terms. The filter keys map onto the **existing virtual-list filter vocabulary**
 * (`filterAssignee`, `filterPriority`, `filterDueDate`, …) rather than inventing a second one.
 *
 * The grammar is astrid-core's `searchParse` and nothing else (ADEV-313, step B of
 * docs/architecture/CORE_RULES_FALLBACK_RETIREMENT.md). There is no TypeScript parser: a query the
 * core cannot parse is refused with {@link SearchUnavailableError}, never guessed. This module keeps
 * the types and the small helpers the search route runs on the core's parse.
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

/** Numeric priority values as stored on Task. */
export function priorityToNumber(priority: SearchPriority): number {
  switch (priority) {
    case 'high': return 3
    case 'medium': return 2
    case 'low': return 1
    default: return 0
  }
}

/** The core could not parse the query. Retry later; nothing was searched. */
export class SearchUnavailableError extends Error {
  readonly retryable = true
  constructor(reason: string) {
    super(`Search is unavailable: ${reason}`)
    this.name = 'SearchUnavailableError'
  }
}

/** Parses a query, or returns `undefined` when it cannot (the search is then refused). */
export type SearchQueryCore = (query: string) => ParsedSearchQuery | undefined

// On globalThis, as with lib/list-permissions.ts's hook: Next compiles this module into several
// layers, each with its own module state, and the core is installed once from instrumentation.ts.
const CORE_KEY = Symbol.for('astrid.searchQuery.core')
type CoreHost = { [CORE_KEY]?: SearchQueryCore | null }

/**
 * Install (or, with `null`, remove) astrid-core's `searchParse` as the parser behind
 * {@link parseSearchQuery} — lib/core-rules/search-query-core.ts, installed from
 * instrumentation.ts on the Node runtime (AWTD-1062).
 *
 * A hook rather than an import so this module stays pure: nothing here may load WebAssembly from
 * disk. Where nothing is installed every parse is refused; tests get the vendored core from the
 * shared vitest setup (tests/support/install-search-core.ts).
 */
export function setSearchQueryCore(core: SearchQueryCore | null): void {
  ;(globalThis as CoreHost)[CORE_KEY] = core
}

const SEARCH_PRIORITIES: ReadonlySet<unknown> = new Set(['none', 'low', 'medium', 'high'])
const SEARCH_DUES: ReadonlySet<unknown> = new Set(['today', 'overdue', 'week', 'month', 'none'])
const SEARCH_STATES: ReadonlySet<unknown> = new Set(['open', 'done', 'canceled'])

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string')

/**
 * Is this a parse the search route can act on — every field present, of its type, and from its
 * vocabulary? A core answer that is not is refused.
 */
export function isParsedSearchQuery(value: unknown): value is ParsedSearchQuery {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const nullableString = (x: unknown) => x === null || typeof x === 'string'
  return (
    typeof v.text === 'string' &&
    nullableString(v.assignee) &&
    nullableString(v.identifier) &&
    isStringArray(v.listNames) &&
    isStringArray(v.labelNames) &&
    isStringArray(v.statuses) &&
    Array.isArray(v.priorities) &&
    v.priorities.every((p) => SEARCH_PRIORITIES.has(p)) &&
    (v.due === null || SEARCH_DUES.has(v.due)) &&
    (v.state === null || SEARCH_STATES.has(v.state))
  )
}

/**
 * Parse a search query with astrid-core. Throws {@link SearchUnavailableError} when the core is not
 * installed, throws, or answers something that is not a parse.
 */
export function parseSearchQuery(query: string): ParsedSearchQuery {
  const core = (globalThis as CoreHost)[CORE_KEY]
  if (!core) throw new SearchUnavailableError('astrid-core is not loaded')
  let answer: ParsedSearchQuery | undefined
  try {
    answer = core(query)
  } catch {
    throw new SearchUnavailableError('astrid-core threw')
  }
  if (answer === undefined || !isParsedSearchQuery(answer)) {
    throw new SearchUnavailableError('astrid-core did not answer')
  }
  return answer
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
