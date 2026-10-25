/**
 * lib/search-query-parser.ts parsed by astrid-core — web phase 3 (AWTD-1062).
 *
 * On the Node runtime, every `parseSearchQuery` call (GET /api/v1/search is the caller) is put to
 * astrid-core's `searchParse` rule, and the core's parse is returned. The TypeScript parses too,
 * every time, for the same two reasons as list permissions (list-permissions-core.ts):
 *
 * - **Fail-safe.** Its answer is returned whenever the core cannot give one: not loaded, threw,
 *   sent an error envelope, or answered something that is not a parse.
 * - **Comparison.** A disagreement is logged once per distinct shape — which fields differed and
 *   how many tokens the query had, never the query or either answer, because a search is
 *   something a person typed.
 *
 * The same `ASTRID_CORE_RULES` setting chooses the mode for both: unset decides with the core,
 * `shadow` keeps the TypeScript deciding and only compares, `off` loads nothing.
 */
import { createLogger } from '@/lib/logger'
import {
  isEmptySearch,
  isParsedSearchQuery,
  setSearchQueryCore,
  type ParsedSearchQuery,
} from '@/lib/search-query-parser'
import { coreRulesModeFrom, type CoreRulesStatus, type CoreRulesMode, type CoreStats } from './list-permissions-core'
import { loadCoreRules } from './wasm'

interface Reporter {
  disagreement(details: Record<string, unknown>): void
  failure(details: Record<string, unknown>): void
}

/** Distinct disagreements logged per process, at most. */
const MAX_LOGGED = 50

const FIELDS: ReadonlyArray<keyof ParsedSearchQuery> = [
  'text',
  'assignee',
  'listNames',
  'labelNames',
  'priorities',
  'due',
  'state',
  'statuses',
  'identifier',
]

/** The fields on which two parses differ — the whole of what a disagreement report carries. */
function differingFields(a: ParsedSearchQuery, b: ParsedSearchQuery): string[] {
  return FIELDS.filter((field) => JSON.stringify(a[field]) !== JSON.stringify(b[field]))
}

/**
 * A {@link setSearchQueryCore} parser backed by `runJson` (astrid-core `rules::run_json`). In
 * `decide` mode it returns the core's parse; in `shadow` mode `undefined`, so the TypeScript
 * decides. A core that THROWS is switched off for the rest of the process, as for permissions.
 */
export function createSearchQueryCore(
  runJson: (request: string) => string,
  report: Reporter,
  { revision = 'unknown', mode = 'decide' }: { revision?: string; mode?: Exclude<CoreRulesMode, 'off'> } = {},
) {
  const stats: CoreStats = { agreed: 0, disagreed: 0, skipped: 0, failed: 0 }
  const logged = new Set<string>()
  let failureLogged = false
  let tripped = false

  function fail(error: unknown): undefined {
    stats.failed++
    if (!failureLogged) {
      failureLogged = true
      try {
        report.failure({ rule: 'searchParse', revision, mode, tripped, error: String(error) })
      } catch {
        // A reporter that throws must not change an answer.
      }
    }
    return undefined
  }

  function parse(query: string, typescriptAnswer: ParsedSearchQuery): ParsedSearchQuery | undefined {
    if (tripped) return fail('core switched off after it threw')
    if (typeof query !== 'string') {
      stats.skipped++
      return undefined
    }

    let raw: string
    try {
      raw = runJson(JSON.stringify({ kind: 'searchParse', query }))
    } catch (error) {
      tripped = true
      return fail(error)
    }

    let core: ParsedSearchQuery
    try {
      const reply = JSON.parse(raw) as { ok: boolean; value?: Record<string, unknown>; error?: { kind?: string } }
      if (!reply.ok || !reply.value) throw new Error(`core answered ${reply.error?.kind ?? 'no value'}`)
      const { isEmpty, ...parsed } = reply.value
      if (!isParsedSearchQuery(parsed)) throw new Error('core answered something that is not a parse')
      // The route decides "asks for nothing" from the parse; the core's own verdict must agree, or
      // the parse is not one this route can trust.
      if (isEmpty !== isEmptySearch(parsed)) throw new Error('core isEmpty disagrees with its own parse')
      core = {
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
    } catch (error) {
      return fail(error)
    }

    const differing = differingFields(core, typescriptAnswer)
    if (differing.length === 0) {
      stats.agreed++
    } else {
      stats.disagreed++
      try {
        const tokens = query.trim() ? query.trim().split(/\s+/).length : 0
        const signature = JSON.stringify({ differing, tokens: Math.min(tokens, 5) })
        if (logged.size < MAX_LOGGED && !logged.has(signature)) {
          logged.add(signature)
          report.disagreement({
            rule: 'searchParse',
            differing,
            tokens,
            revision,
            mode,
            returned: mode === 'decide' ? 'core' : 'typescript',
            stats: { ...stats },
          })
        }
      } catch {
        // Reporting must never change an answer.
      }
    }

    return mode === 'decide' ? core : undefined
  }

  return { parse, stats }
}

const STATUS_KEY = Symbol.for('astrid.searchQuery.coreStatus')
type StatusHost = { [STATUS_KEY]?: CoreRulesStatus }

/** What instrumentation.ts installed in this process, for /api/health. `null` before it ran. */
export function searchQueryCoreStatus(): CoreRulesStatus | null {
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
  host[STATUS_KEY] = { mode, loaded: false, revision: null, stats: null }
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
        disagreement: (details) => log.warn(details, 'search query: astrid-core and the TypeScript parse differently'),
        failure: (details) => log.error(details, 'search query: astrid-core could not parse; the TypeScript parse was used'),
      },
      { revision: core.revision, mode },
    )
    setSearchQueryCore(parser.parse)
    host[STATUS_KEY] = { mode, loaded: true, revision: core.revision, stats: parser.stats }
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
