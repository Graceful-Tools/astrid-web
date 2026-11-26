/**
 * lib/search-query-parser.ts parsed by astrid-core — web phase 3 (AWTD-1062).
 *
 * On the Node runtime, every `parseSearchQuery` call (GET /api/v1/search is the caller) is put to
 * astrid-core's `searchParse` rule, and the core's parse is returned. The TypeScript parse is the
 * fail-safe: it is returned whenever the core cannot give one (not loaded, threw, sent an error
 * envelope, or answered something that is not a parse). The server comparison was retired
 * (AWTD-1608, step A of docs/architecture/CORE_RULES_FALLBACK_RETIREMENT.md), so a query the core
 * parses runs no TypeScript; the search fixture parity test still holds the two together.
 *
 * The same `ASTRID_CORE_RULES` setting chooses the mode for every rule: unset decides with the
 * core, `shadow` keeps the TypeScript deciding without asking the core, `off` loads nothing.
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
 * A {@link setSearchQueryCore} parser backed by `runJson` (astrid-core `rules::run_json`). In
 * `decide` mode it returns the core's parse, or `undefined` for the TypeScript fallback; in
 * `shadow` mode always `undefined`. A core that THROWS is switched off for the rest of the process.
 */
export function createSearchQueryCore(
  runJson: (request: string) => string,
  report: FailureReporter,
  { revision = 'unknown', mode = 'decide' }: { revision?: string; mode?: Exclude<CoreRulesMode, 'off'> } = {},
) {
  const core = createCoreAsker('searchParse', runJson, report, { revision, mode })

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
 * Load the vendored core and install it as the parser behind lib/search-query-parser.ts. Called
 * from instrumentation.ts on the Node runtime. Returns whether the core is installed; never throws.
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
      log.error({ mode }, 'packages/astrid-rules did not load; search queries are parsed by the TypeScript')
      return false
    }
    const parser = createSearchQueryCore(
      core.runJson,
      {
        failure: (details) => log.error(details, 'search query: astrid-core could not parse; the TypeScript parse was used'),
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
      log.error({ err: error, mode }, 'search query: astrid-core install failed; the TypeScript parses')
    } catch {
      // Never fatal.
    }
    return false
  }
}
