/**
 * The shape of a task estimate and the one place that turns untrusted input into it
 * (ADEV-278, docs/specs/GOALS_GUARDRAILS_SIGNALS.md → Estimates, Estimator output is untrusted data).
 *
 * An estimator's reply (a service's, the built-in model's, or a person's form) is data. Ids must be
 * ones the project states, numbers are clamped, strings are capped, and `rationale` is plain text.
 * A missing section is "not estimated"; it is never filled in.
 */

export const ESTIMATOR_CONTRACT = 'astrid.estimator/v1'
export const ESTIMATE_LEVELS = ['low', 'medium', 'high'] as const
export type EstimateLevel = (typeof ESTIMATE_LEVELS)[number]

export const RATIONALE_MAX_CHARS = 2000
export const FACTOR_MAX_CHARS = 200
export const FACTORS_MAX = 10
export const UNIT_MAX_CHARS = 24
const IMPACT_ABS_MAX = 1e12
const COST_MICROCENTS_MAX = 1e15 // $10 million of cents is 1e9; this is far above any real task
const EFFORT_HOURS_MAX = 100_000
const REACH_COUNT_MAX = 1e12

export interface GoalImpact {
  goalId: string
  delta: number
  low: number
  high: number
  unit?: string
  kind: 'absolute' | 'relative'
}

export interface GuardrailImpact {
  guardrailId: string
  delta: number
  low: number
  high: number
  breachProbability?: number
}

export interface EstimateRisk {
  level: EstimateLevel
  score?: number
  factors: string[]
}

export interface EstimateReach {
  count: number
  unit: string
  period: string
  share?: number
}

/** What an estimate says, after validation. Everything but `confidence` is optional input. */
export interface EstimateBody {
  goalImpacts: GoalImpact[]
  guardrailImpacts: GuardrailImpact[]
  risk: EstimateRisk
  costMicrocents: number | null
  effortHours: number | null
  reach: EstimateReach | null
  confidence: EstimateLevel
  rationale: string | null
}

export interface EstimateScope {
  goalIds: ReadonlySet<string>
  guardrailIds: ReadonlySet<string>
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** A finite number clamped to ±max, or undefined when it is not a number. */
export function clampNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, value))
}

/** Plain text: control characters and angle brackets removed, whitespace collapsed, capped. */
export function plainText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value
     
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '')
    .replace(/[<>]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
  return text ? text.slice(0, max) : undefined
}

export function parseLevel(value: unknown): EstimateLevel | undefined {
  return ESTIMATE_LEVELS.includes(value as EstimateLevel) ? (value as EstimateLevel) : undefined
}

/** low <= delta <= high, whatever order the sender gave them. */
function orderedRange(item: Record<string, unknown>): { delta: number; low: number; high: number } | null {
  const delta = clampNumber(item.delta, -IMPACT_ABS_MAX, IMPACT_ABS_MAX)
  const low = clampNumber(item.low, -IMPACT_ABS_MAX, IMPACT_ABS_MAX)
  const high = clampNumber(item.high, -IMPACT_ABS_MAX, IMPACT_ABS_MAX)
  if (delta === undefined || low === undefined || high === undefined) return null
  const lo = Math.min(low, high, delta)
  const hi = Math.max(low, high, delta)
  return { delta, low: lo, high: hi }
}

function goalImpacts(raw: unknown, scope: EstimateScope): GoalImpact[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: GoalImpact[] = []
  for (const item of raw) {
    if (!isRecord(item) || typeof item.goalId !== 'string') continue
    if (!scope.goalIds.has(item.goalId) || seen.has(item.goalId)) continue
    const range = orderedRange(item)
    if (!range) continue
    seen.add(item.goalId)
    const unit = plainText(item.unit, UNIT_MAX_CHARS)
    out.push({
      goalId: item.goalId,
      ...range,
      ...(unit ? { unit } : {}),
      kind: item.kind === 'relative' ? 'relative' : 'absolute',
    })
  }
  return out
}

function guardrailImpacts(raw: unknown, scope: EstimateScope): GuardrailImpact[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: GuardrailImpact[] = []
  for (const item of raw) {
    if (!isRecord(item) || typeof item.guardrailId !== 'string') continue
    if (!scope.guardrailIds.has(item.guardrailId) || seen.has(item.guardrailId)) continue
    const range = orderedRange(item)
    if (!range) continue
    seen.add(item.guardrailId)
    const breachProbability = clampNumber(item.breachProbability, 0, 1)
    out.push({
      guardrailId: item.guardrailId,
      ...range,
      ...(breachProbability !== undefined ? { breachProbability } : {}),
    })
  }
  return out
}

function risk(raw: unknown): EstimateRisk {
  const item = isRecord(raw) ? raw : {}
  const score = clampNumber(item.score, 0, 1)
  const factors = (Array.isArray(item.factors) ? item.factors : [])
    .map(f => plainText(f, FACTOR_MAX_CHARS))
    .filter((f): f is string => !!f)
    .slice(0, FACTORS_MAX)
  return {
    // "Not estimated" is not "low risk": an absent level reads as unknown, which `high` is the
    // safe stand-in for until the policy has an explicit unknown. A person sees the empty factors.
    level: parseLevel(item.level) ?? 'high',
    ...(score !== undefined ? { score } : {}),
    factors,
  }
}

function reach(raw: unknown): EstimateReach | null {
  if (!isRecord(raw)) return null
  const count = clampNumber(raw.count, 0, REACH_COUNT_MAX)
  const unit = plainText(raw.unit, UNIT_MAX_CHARS)
  const period = plainText(raw.period, UNIT_MAX_CHARS)
  if (count === undefined || !unit || !period) return null
  const share = clampNumber(raw.share, 0, 1)
  return { count, unit, period, ...(share !== undefined ? { share } : {}) }
}

/** Validate any estimator's output against what the project states. Pure. */
export function sanitizeEstimate(raw: unknown, scope: EstimateScope): EstimateBody {
  const item = isRecord(raw) ? raw : {}
  const cost = clampNumber(item.costMicrocents, 0, COST_MICROCENTS_MAX)
  const effort = clampNumber(item.effortHours, 0, EFFORT_HOURS_MAX)
  return {
    goalImpacts: goalImpacts(item.goalImpacts, scope),
    guardrailImpacts: guardrailImpacts(item.guardrailImpacts, scope),
    risk: risk(item.risk),
    costMicrocents: cost === undefined ? null : Math.round(cost),
    effortHours: effort ?? null,
    reach: reach(item.reach),
    confidence: parseLevel(item.confidence) ?? 'low',
    rationale: plainText(item.rationale, RATIONALE_MAX_CHARS) ?? null,
  }
}

/** True when the body says nothing the policy could use. */
export function isEmptyEstimate(body: EstimateBody): boolean {
  return (
    !body.goalImpacts.length &&
    !body.guardrailImpacts.length &&
    body.risk.factors.length === 0 &&
    body.costMicrocents === null &&
    body.effortHours === null &&
    body.reach === null
  )
}

/** What the server forces on a built-in estimate, whatever the model said. */
export function markBuiltinEstimate(body: EstimateBody): EstimateBody {
  return { ...body, confidence: 'low' }
}
