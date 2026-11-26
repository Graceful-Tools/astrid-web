/**
 * Asking astrid-core for a rule whose server comparison is retired (AWTD-1608, step A of
 * docs/architecture/CORE_RULES_FALLBACK_RETIREMENT.md).
 *
 * listAccess, searchParse, nextOccurrence and the board's columns showed no disagreement and no
 * failure in production, so the server no longer runs the TypeScript to compare. In decide mode
 * the core answers, and the TypeScript runs only as the fail-safe: when the core is not loaded,
 * threw, sent an error envelope, or answered something that is not an answer. In shadow mode (the
 * no-code rollback) the core is not asked at all and the TypeScript decides.
 *
 * Pure: no Node imports, so the browser door can use it too.
 */
import type { CoreRulesMode } from './list-permissions-decider'

/** /api/health's totals for a retired rule. There is no comparison, so no agreed or disagreed. */
export interface AnswerStats {
  /** The core answered; the TypeScript was not run. */
  answered: number
  /** Not put to the core: outside its domain (a signed-out check, a query that is not a string), or shadow mode. */
  skipped: number
  /** The core could not answer; the TypeScript answer was returned. */
  failed: number
}

/** /api/health's block for a retired rule. */
export interface RetiredRuleStatus {
  mode: CoreRulesMode
  /** The server comparison was retired (AWTD-1608): the TypeScript runs only when the core fails. */
  compare: 'retired'
  /** Whether packages/astrid-rules loaded. False with mode `decide` means the TypeScript decides. */
  loaded: boolean
  revision: string | null
  stats: AnswerStats | null
}

export interface FailureReporter {
  failure(details: Record<string, unknown>): void
}

/**
 * One rule's asker. `ask` returns the core's answer, read and checked by `read` (which throws for
 * something that is not an answer), or `undefined` for the caller's TypeScript fallback. A failure
 * is logged once per process. A core that THROWS is switched off for the rest of the process: a
 * WebAssembly trap can leave the instance unusable, and every later call would cost a throw to
 * reach the same fallback. An error envelope is only that one question's failure.
 */
export function createCoreAsker(
  rule: string,
  runJson: (request: string) => string,
  report: FailureReporter,
  { revision, mode }: { revision: string; mode: Exclude<CoreRulesMode, 'off'> },
) {
  const stats: AnswerStats = { answered: 0, skipped: 0, failed: 0 }
  let failureLogged = false
  let tripped = false

  function fail(error: unknown, details: Record<string, unknown> = { rule }): undefined {
    stats.failed++
    if (!failureLogged) {
      failureLogged = true
      try {
        report.failure({ ...details, revision, mode, tripped, error: String(error) })
      } catch {
        // A reporter that throws must not change an answer.
      }
    }
    return undefined
  }

  function skip(): undefined {
    stats.skipped++
    return undefined
  }

  function ask<T>(request: object, read: (value: unknown) => T, details?: Record<string, unknown>): T | undefined {
    if (tripped) return fail('core switched off after it threw', details)
    if (mode === 'shadow') return skip()
    let raw: string
    try {
      raw = runJson(JSON.stringify(request))
    } catch (error) {
      tripped = true
      return fail(error, details)
    }
    let answer: T
    try {
      const reply = JSON.parse(raw) as { ok: boolean; value?: unknown; error?: { kind?: string } }
      if (!reply.ok || reply.value === undefined) throw new Error(`core answered ${reply.error?.kind ?? 'no value'}`)
      answer = read(reply.value)
    } catch (error) {
      return fail(error, details)
    }
    stats.answered++
    return answer
  }

  return { ask, fail, skip, stats, isTripped: () => tripped }
}
