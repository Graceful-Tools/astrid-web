/**
 * Pure rules for a task's experiment link and post-deploy verification (ADEV-279,
 * docs/specs/GOALS_GUARDRAILS_SIGNALS.md → The model → 5, The three contracts → Experiment source).
 * Client-safe: no server imports.
 *
 * **Astrid computes no statistics.** An experiment's deltas, intervals, significance, verdict and
 * recommendation are the service's, read here as untrusted data and clipped to what a row may hold.
 * The one comparison Astrid does make is a *verification's*: the project's goal and guardrail values
 * recorded at deploy (`baseline`) against the values the project's own metric sources report when
 * `decideBy` comes. That is a before/after of numbers the project already holds, not an inference.
 */

import {
  isReadingFresh,
  metricCheckViolation,
  type GoalsAndGuardrails,
  type MetricGuardrailCheck,
} from '@/lib/goals-guardrails'

export const EXPERIMENT_SOURCE_CONTRACT = 'astrid.experiment-source/v1'

export const EXPERIMENT_KINDS = ['experiment', 'verification'] as const
export type ExperimentKind = (typeof EXPERIMENT_KINDS)[number]
export const EXPERIMENT_STATES = ['pending', 'running', 'concluded', 'stopped', 'unknown'] as const
export type ExperimentState = (typeof EXPERIMENT_STATES)[number]
export const EXPERIMENT_VERDICTS = ['improving', 'flat', 'regressing', 'inconclusive'] as const
export type ExperimentVerdict = (typeof EXPERIMENT_VERDICTS)[number]
export const RECOMMENDATION_ACTIONS = ['start', 'continue', 'stop', 'ship', 'rollback'] as const
export type RecommendationAction = (typeof RECOMMENDATION_ACTIONS)[number]

export const EXPERIMENT_KEY_MAX_CHARS = 200
export const EXPERIMENT_REASON_MAX_CHARS = 500
export const EXPERIMENT_METRICS_MAX = 20
/** The longest verification window: a result that takes longer is not "post-deploy". */
export const VERIFICATION_MAX_DAYS = 90
/** An experiment source's reading older than this is "no data since …", not a result (P4). */
export const EXPERIMENT_STALE_AFTER_HOURS = 48

export interface ExperimentRecommendation {
  action: RecommendationAction
  reason: string
}

/** One metric of an experiment's reply: every number is the service's. */
export interface ExperimentMetric {
  metricKey: string
  goalId?: string
  control?: number
  treatment?: number
  relDelta?: number
  ci?: [number, number]
  significant?: boolean
}

/** What of an experiment service's reply is kept. */
export interface ExperimentReading {
  state: ExperimentState
  verdict: ExperimentVerdict | null
  recommendation: ExperimentRecommendation | null
  startedAt: string | null
  url: string | null
  /** When the service says the reading is from. */
  at: string
  metrics: ExperimentMetric[]
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)
const clip = (v: string, max: number) => v.trim().slice(0, max)

function isoOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

function sanitizeMetric(raw: unknown): ExperimentMetric | null {
  if (!isRecord(raw) || typeof raw.metricKey !== 'string' || !raw.metricKey.trim()) return null
  const metric: ExperimentMetric = { metricKey: clip(raw.metricKey, EXPERIMENT_KEY_MAX_CHARS) }
  if (typeof raw.goalId === 'string' && raw.goalId.trim()) metric.goalId = clip(raw.goalId, EXPERIMENT_KEY_MAX_CHARS)
  if (finite(raw.control)) metric.control = raw.control
  if (finite(raw.treatment)) metric.treatment = raw.treatment
  if (finite(raw.relDelta)) metric.relDelta = raw.relDelta
  if (Array.isArray(raw.ci) && raw.ci.length === 2 && finite(raw.ci[0]) && finite(raw.ci[1])) metric.ci = [raw.ci[0], raw.ci[1]]
  if (typeof raw.significant === 'boolean') metric.significant = raw.significant
  return metric
}

/**
 * The entry of an experiment-source reply that answers `key`, as a reading. Null when the reply is
 * not the contract (no entry for the key, no state, no readable `at`): never guessed at. An unknown
 * `state` or `verdict` is dropped to `unknown` / none rather than trusted.
 */
export function sanitizeExperimentReply(reply: unknown, key: string, now: Date): ExperimentReading | null {
  if (!isRecord(reply) || !Array.isArray(reply.experiments)) return null
  const entry = reply.experiments.find((e): e is Record<string, unknown> => isRecord(e) && e.key === key)
  if (!entry) return null
  // The service's own clock is the freshness of the reading, but a date from the future is a fault.
  const at = isoOrNull(entry.at)
  if (!at || Date.parse(at) > now.getTime() + 5 * 60_000) return null
  const rec = isRecord(entry.recommendation) && oneOf(RECOMMENDATION_ACTIONS, entry.recommendation.action)
    ? {
        action: entry.recommendation.action,
        reason: typeof entry.recommendation.reason === 'string' ? clip(entry.recommendation.reason, EXPERIMENT_REASON_MAX_CHARS) : '',
      }
    : null
  const metrics = (Array.isArray(entry.metrics) ? entry.metrics : [])
    .slice(0, EXPERIMENT_METRICS_MAX)
    .map(sanitizeMetric)
    .filter((m): m is ExperimentMetric => m !== null)
  return {
    state: oneOf(EXPERIMENT_STATES, entry.state) ? entry.state : 'unknown',
    verdict: oneOf(EXPERIMENT_VERDICTS, entry.verdict) ? entry.verdict : null,
    recommendation: rec,
    startedAt: isoOrNull(entry.startedAt),
    url: typeof entry.url === 'string' && /^https:\/\//i.test(entry.url) ? entry.url.slice(0, 500) : null,
    at,
    metrics,
  }
}

// ── Verification ──────────────────────────────────────────────────────────────

export interface BaselineValue {
  id: string
  value: number
  /** ISO time of the reading. */
  at: string
}

/** The goal and guardrail values at the moment a verification started. */
export interface VerificationBaseline {
  at: string
  goals: BaselineValue[]
  guardrails: BaselineValue[]
}

/** The fresh numeric readings the project holds now; a stale or missing one is left out (unknown). */
export function captureBaseline(stated: GoalsAndGuardrails, now: Date): VerificationBaseline {
  const goals: BaselineValue[] = []
  for (const goal of stated.goals) {
    const m = goal.metric
    if (m && finite(m.current) && m.measuredAt && isReadingFresh(m.measuredAt, m.staleAfterHours, now)) {
      goals.push({ id: goal.id, value: m.current, at: m.measuredAt })
    }
  }
  const guardrails: BaselineValue[] = []
  for (const rail of stated.guardrails) {
    const c = rail.check
    if (rail.kind === 'enforced' && c?.type === 'metric' && finite(c.current) && c.measuredAt && isReadingFresh(c.measuredAt, c.staleAfterHours, now)) {
      guardrails.push({ id: rail.id, value: c.current, at: c.measuredAt })
    }
  }
  return { at: now.toISOString(), goals, guardrails }
}

/** Parse a stored baseline, or null when the column holds something else. */
export function storedBaseline(json: unknown): VerificationBaseline | null {
  if (!isRecord(json) || typeof json.at !== 'string') return null
  const values = (raw: unknown): BaselineValue[] =>
    (Array.isArray(raw) ? raw : []).filter(
      (v): v is BaselineValue => isRecord(v) && typeof v.id === 'string' && finite(v.value) && typeof v.at === 'string',
    )
  return { at: json.at, goals: values(json.goals), guardrails: values(json.guardrails) }
}

export interface VerificationFinding {
  kind: 'goal' | 'guardrail'
  id: string
  /** What the finding is, in a sentence a person can read. */
  text: string
  /** `regressed` and `breached` fail the verification. */
  outcome: 'improved' | 'held' | 'regressed' | 'breached' | 'unknown'
  before?: number
  after?: number
}

export interface VerificationResult {
  verdict: ExperimentVerdict
  findings: VerificationFinding[]
}

/**
 * The verification's verdict, from the baseline and what the project's sources report now.
 *
 * - A **guardrail breached** (a fresh reading on the wrong side of its threshold) or a **goal
 *   regressed** (it moved against its `direction` since the baseline) is `regressing`.
 * - Otherwise, with at least one goal or guardrail that could be compared, the window ended with
 *   neither: `improving` (the spec's P2 reading: it passed). A goal that merely held counts.
 * - With nothing comparable (no baseline value had a fresh reading now) it is `inconclusive`:
 *   unknown is never a pass.
 *
 * Only values with a baseline are compared, so a goal that gained a source after deploy is not
 * judged against nothing.
 */
export function compareVerification(
  baseline: VerificationBaseline | null,
  stated: GoalsAndGuardrails,
  now: Date,
): VerificationResult {
  const findings: VerificationFinding[] = []
  const base = baseline ?? { at: now.toISOString(), goals: [], guardrails: [] }
  // A reading counts only if it was taken after the deploy: an older one cannot vouch for it.
  const deployedAt = Date.parse(base.at)
  const sinceDeploy = (measuredAt: string) => Date.parse(measuredAt) >= deployedAt

  for (const before of base.goals) {
    const goal = stated.goals.find(g => g.id === before.id)
    const m = goal?.metric
    if (!goal || !m) continue
    const label = goal.measure?.trim() || goal.statement
    if (!finite(m.current) || !m.measuredAt || !isReadingFresh(m.measuredAt, m.staleAfterHours, now) || !sinceDeploy(m.measuredAt)) {
      findings.push({ kind: 'goal', id: goal.id, outcome: 'unknown', before: before.value, text: `${label}: no fresh reading since the deploy` })
      continue
    }
    const moved = (m.current - before.value) * (m.direction === 'down' ? -1 : 1)
    const outcome = moved < 0 ? 'regressed' : moved > 0 ? 'improved' : 'held'
    findings.push({ kind: 'goal', id: goal.id, outcome, before: before.value, after: m.current, text: `${label}: ${before.value} → ${m.current}` })
  }

  for (const rail of stated.guardrails) {
    const check = rail.check
    if (rail.kind !== 'enforced' || check?.type !== 'metric') continue
    const hadBaseline = base.guardrails.find(g => g.id === rail.id)
    const fresh = finite(check.current) && !!check.measuredAt && isReadingFresh(check.measuredAt, check.staleAfterHours, now) && sinceDeploy(check.measuredAt)
    if (!fresh) {
      if (hadBaseline) findings.push({ kind: 'guardrail', id: rail.id, outcome: 'unknown', before: hadBaseline.value, text: `${rail.statement}: no fresh reading since the deploy` })
      continue
    }
    const reason = metricCheckViolation(check as MetricGuardrailCheck, now)
    if (reason !== null) {
      findings.push({ kind: 'guardrail', id: rail.id, outcome: 'breached', before: hadBaseline?.value, after: check.current, text: `${rail.statement}: ${reason}` })
    } else if (hadBaseline) {
      findings.push({ kind: 'guardrail', id: rail.id, outcome: 'held', before: hadBaseline.value, after: check.current, text: `${rail.statement}: holds (${check.current})` })
    }
  }

  const failed = findings.some(f => f.outcome === 'regressed' || f.outcome === 'breached')
  const compared = findings.some(f => f.outcome === 'improved' || f.outcome === 'held')
  return { verdict: failed ? 'regressing' : compared ? 'improving' : 'inconclusive', findings }
}

/** A short plain-language report of a verification, for the system comment. */
export function verificationSummary(result: VerificationResult): string {
  if (!result.findings.length) return 'No goal or guardrail had a reading to compare.'
  return result.findings.map(f => `- ${f.text}`).join('\n')
}

// ── What the lane rules read ──────────────────────────────────────────────────

export interface ExperimentRowLike {
  kind: string
  state: string
  verdict: string | null
  decideBy: Date | null
  fetchedAt: Date | null
}

export interface ResultConditionWire {
  kind: ExperimentKind
  state: 'open' | 'concluded'
  verdict?: 'improving' | 'regressing' | 'inconclusive'
  decideBy?: string
  fetchedAt?: string
}

/**
 * A stored link as astrid-core's `ResultCondition` (crates/astrid-rules/src/results.rs). A `stopped`
 * link is over, with the verdict it had. The core has no `flat`: an experiment that found no effect
 * did not pass and did not regress, which is its `inconclusive`.
 */
export function toResultCondition(row: ExperimentRowLike): ResultConditionWire {
  const concluded = row.state === 'concluded' || row.state === 'stopped'
  const verdict = row.verdict === 'improving' ? 'improving' : row.verdict === 'regressing' ? 'regressing' : row.verdict ? 'inconclusive' : undefined
  return {
    kind: row.kind === 'verification' ? 'verification' : 'experiment',
    state: concluded ? 'concluded' : 'open',
    ...(concluded && verdict ? { verdict } : {}),
    ...(row.decideBy ? { decideBy: row.decideBy.toISOString() } : {}),
    ...(row.fetchedAt ? { fetchedAt: row.fetchedAt.toISOString() } : {}),
  }
}

/** Whether a link is still waiting on its result. */
export const isOpenExperiment = (row: Pick<ExperimentRowLike, 'state'>) => row.state !== 'concluded' && row.state !== 'stopped'

/** The latest instant a verification window of `days` may end, as a day count from `from`. */
export function decideByFromDays(days: number, from: Date): Date | null {
  if (!Number.isFinite(days) || days < 1 || days > VERIFICATION_MAX_DAYS) return null
  return new Date(from.getTime() + Math.floor(days) * 86_400_000)
}
