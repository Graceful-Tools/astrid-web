/**
 * The trade-off policy's rule, asked of astrid-core (ADEV-281) — server (Node runtime) only.
 *
 * Core-first: `astrid_rules::tradeoff` is canonical (ADEV-273; astrid-core docs/GOAL_SIGNALS.md §2),
 * and `tradeoffEvaluate` is on the rules door behind the `tradeoff` feature, which the Node wasm
 * package carries and the browser package does not (the browser only compares the stored keys).
 *
 * **There is no TypeScript mirror of the evaluation, on purpose.** The mirror in
 * lib/orchestration-policy.ts covers the policy's *shape* (the `tradeoff` key, its validation and
 * layering, and the three new autonomy actions), because the settings UI needs that in the browser.
 * The label and the sort key are computed once, on the server, and stored; nothing in a client
 * re-derives them. A build that cannot answer therefore answers `null` here and the caller stores
 * no label, which is the same as no policy stated: nothing is drawn.
 */
import { createLogger } from '@/lib/logger'
import type { Level, TradeoffLabel } from '@/lib/orchestration-policy'
import { loadCoreRules, type CoreRules } from './wasm'

const log = createLogger('core-rules.tradeoff')

/** One reason an estimate earned its label: a code and the values behind it (core `tradeoff::Reason`). */
export type TradeoffReason = { code: string } & Record<string, unknown>

export interface TradeoffEvaluation {
  label: TradeoffLabel
  reasons: TradeoffReason[]
  /** Compared lexicographically, smaller first. Never evaluated by a client. */
  sortKey: number[]
}

/** An estimate as the core reads it (core `tradeoff::Estimate`). A section left out is one the estimator did not return. */
export interface TradeoffEstimate {
  goalImpacts?: { goalId: string; delta: number; low: number; high: number; direction?: 'up' | 'down' }[] | null
  guardrailImpacts?: { guardrailId: string; breachProbability: number }[] | null
  risk?: { level: Level } | null
  confidence?: Level | null
  source?: string | null
  createdAt?: string | null
  costMicrocents?: number | null
  stale?: boolean
  guardrailsStated?: boolean
}

export type TradeoffAnswer =
  | { ok: true; value: TradeoffEvaluation | null }
  | { ok: false; error: { kind: 'badRequest'; message: string } }

let installed: CoreRules | null | undefined
let loggedFailure = false

/** Does this build answer `tradeoffEvaluate`? A pin before 4a refuses the kind. */
export function coreAnswersTradeoff(core: CoreRules | null): boolean {
  if (!core) return false
  try {
    const reply = JSON.parse(
      core.runJson(JSON.stringify({ kind: 'tradeoffEvaluate', project: null, list: null, estimate: null })),
    ) as { ok?: boolean }
    return reply.ok === true
  } catch {
    return false
  }
}

function tradeoffCore(): CoreRules | null {
  if (installed === undefined) {
    const core = loadCoreRules()
    installed = coreAnswersTradeoff(core) ? core : null
  }
  return installed
}

/** Tests: install a build (or none). `undefined` re-probes the vendored one. */
export function setTradeoffCoreForTests(core: CoreRules | null | undefined): void {
  installed = core === undefined ? undefined : coreAnswersTradeoff(core) ? core : null
}

/**
 * The sort key lands in a JSON column and goes back to the core as `i64`. The core uses `i64::MAX`
 * for "unknown" (no cost, no date), which JavaScript reads as 2^63 and cannot send back. Every value
 * is clamped to the safe-integer range: still larger than any real cost in microcents (the estimate is
 * capped at 1e15) and any date, so the order is unchanged.
 */
export function storableSortKey(key: readonly number[]): number[] {
  return key.map(n => Math.max(-Number.MAX_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, n)))
}

/**
 * The label, reasons and sort key `estimate` earns under the policy stored on the project and the
 * list. `{ ok: true, value: null }` is "no policy stated". `null` is "the core could not answer".
 */
export function evaluateTradeoff(stored: { project?: unknown; list?: unknown }, estimate: TradeoffEstimate | null): TradeoffAnswer | null {
  const core = tradeoffCore()
  if (!core) return null
  try {
    const answer = JSON.parse(
      core.runJson(JSON.stringify({ kind: 'tradeoffEvaluate', project: stored.project ?? null, list: stored.list ?? null, estimate })),
    ) as TradeoffAnswer
    if (answer.ok && answer.value) {
      return { ok: true, value: { ...answer.value, sortKey: storableSortKey(answer.value.sortKey) } }
    }
    return answer
  } catch (err) {
    if (!loggedFailure) {
      loggedFailure = true
      log.error({ err }, 'astrid-core tradeoffEvaluate failed; no label is stored')
    }
    return null
  }
}
