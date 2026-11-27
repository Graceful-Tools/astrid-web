/**
 * lib/search-query-parser.ts parsed by astrid-core — web phase 3 (AWTD-1062), step B (ADEV-313).
 *
 * On the Node runtime, every `parseSearchQuery` call (GET /api/v1/search is the caller) is put to
 * astrid-core's `searchParse` rule, and the core's parse is returned. There is no TypeScript
 * parser any more: when the core cannot give a parse (not loaded, threw, sent an error envelope, or
 * answered something that is not a parse) the search is refused with a retryable 503
 * (SearchUnavailableError), never a guessed parse.
 *
 * `ASTRID_CORE_RULES=off` loads nothing, so searches are refused. `shadow` has no TypeScript left
 * to keep deciding, so for this rule it behaves as `decide`.
 */
import { createLogger } from '@/lib/logger'
import { isEmptySearch, isParsedSearchQuery, setSearchQueryCore, type ParsedSearchQuery } from '@/lib/search-query-parser'
import { coreRulesModeFrom, type CoreRulesMode } from './list-permissions-core'
import { createCoreAsker, type FailureReporter, type RetiredRuleStatus } from './core-asker'
import { loadCoreRules } from './wasm'

/** The core's reply as a parse the route can trust, or a throw. */
function readParse(value: unknown): ParsedSearchQuery {
  if (!value || typeof value !== 'object') throw new Error('core answered no value')
  const { isEmpty, ...parsed } = value as Record<string, unknown>
  if (!isParsedSearchQuery(parsed)) throw new Error('core answered something that is not a parse')
  // The route decides "asks for nothing" from the parse; the core's own verdict must agree, or
  // the parse is not one this route can trust.
  if (isEmpty !== isEmptySearch(parsed)) throw new Error('core isEmpty disagrees with its own parse')
  return {
    text: parsed.text,
    assignee: parsed.assignee,
    listNames: parsed.listNames,
    labelNames: parsed.labelNames,
    priorities: parsed.priorities,
    due: parsed.due,
    state: parsed.state,
    statuses: parsed.statuses,
    identifier: parsed.identifier,
  }
}

/**
 * A {@link setSearchQueryCore} parser backed by `runJson` (astrid-core `rules::run_json`). It
 * returns the core's parse, or `undefined` when the core cannot give one (the search is then
 * refused). A core that THROWS is switched off for the rest of the process.
 */
export function createSearchQueryCore(
  runJson: (request: string) => string,
  report: FailureReporter,
  { revision = 'unknown' }: { revision?: string; mode?: Exclude<CoreRulesMode, 'off'> } = {},
) {
  // No TypeScript is left to decide in shadow mode, so the core is always asked.
  const core = createCoreAsker('searchParse', runJson, report, { revision, mode: 'decide' })

  function parse(query: string): ParsedSearchQuery | undefined {
    if (typeof query !== 'string') return core.skip()
    return core.ask({ kind: 'searchParse', query }, readParse)
  }

  return { parse, stats: core.stats }
}

const STATUS_KEY = Symbol.for('astrid.searchQuery.coreStatus')
type StatusHost = { [STATUS_KEY]?: RetiredRuleStatus }

/** What instrumentation.ts installed in this process, for /api/health. `null` before it ran. */
export function searchQueryCoreStatus(): RetiredRuleStatus | null {
  const status = (globalThis as StatusHost)[STATUS_KEY]
  return status ? { ...status, stats: status.stats ? { ...status.stats } : null } : null
}

/**
 * Load the vendored core and install it as the only parser behind lib/search-query-parser.ts.
 * Called from instrumentation.ts on the Node runtime. Returns whether the core is installed; never
 * throws.
 */
export function installSearchQueryCore(setting: string | undefined = process.env.ASTRID_CORE_RULES): boolean {
  const mode = coreRulesModeFrom(setting)
  const host = globalThis as StatusHost
  host[STATUS_KEY] = { mode, compare: 'retired', loaded: false, revision: null, stats: null }
  if (mode === 'off') {
    setSearchQueryCore(null)
    return false
  }
  const log = createLogger('core-rules')
  try {
    const core = loadCoreRules()
    if (!core) {
      setSearchQueryCore(null)
      log.error({ mode }, 'packages/astrid-rules did not load; searches are refused')
      return false
    }
    const parser = createSearchQueryCore(
      core.runJson,
      {
        failure: (details) => log.error(details, 'search query: astrid-core could not parse; the search was refused'),
      },
      { revision: core.revision, mode },
    )
    setSearchQueryCore(parser.parse)
    host[STATUS_KEY] = { mode, compare: 'retired', loaded: true, revision: core.revision, stats: parser.stats }
    log.info({ revision: core.revision, mode }, 'search query: astrid-core installed')
    return true
  } catch (error) {
    setSearchQueryCore(null)
    try {
      log.error({ err: error, mode }, 'search query: astrid-core install failed; searches are refused')
    } catch {
      // Never fatal.
    }
    return false
  }
}
