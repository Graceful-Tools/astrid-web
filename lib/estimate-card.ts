/**
 * What the estimate card draws, worked out from an estimate and the project's goals and guardrails
 * (ADEV-280, docs/specs/GOALS_GUARDRAILS_SIGNALS.md → Surfaces). Pure and safe for the browser, so the
 * rules (where the reference line sits, what opportunity means, what a built-in estimate may show)
 * are tested without a chart.
 */

import type { EstimateReach, GoalImpact, GuardrailImpact } from '@/lib/task-estimate'
import type { GoalsAndGuardrails } from '@/lib/goals-guardrails'

/** Microcents in a dollar: a microcent is a millionth of a cent. */
const MICROCENTS_PER_DOLLAR = 100_000_000

export interface RangeRow {
  id: string
  statement: string
  low: number
  high: number
  /** Absent on a rough estimate: it shows ranges only. */
  delta: number | null
  unit?: string
  /** Where the target or limit sits on this row's axis (a change from now), when it can be told. */
  reference: number | null
  /** Guardrails only. */
  breachProbability?: number
}

const fixed = (n: number) => (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100)

/** `+0.4`, `-12`, `0`: a signed number, trimmed. */
export function formatSigned(n: number): string {
  const value = fixed(n)
  return value > 0 ? `+${value}` : String(value)
}

/** `1.2k`, `41k`, `3.5M`: a count at a readable size. */
export function formatCount(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${fixed(n / 1e9)}B`
  if (abs >= 1e6) return `${fixed(n / 1e6)}M`
  if (abs >= 1e3) return `${fixed(n / 1e3)}k`
  return String(fixed(n))
}

/** `+1.2k`, `-300`: a signed count at a readable size. */
export function formatSignedCount(n: number): string {
  const text = formatCount(n)
  return n > 0 ? `+${text}` : text
}

export function microcentsToDollars(microcents: number): number {
  return microcents / MICROCENTS_PER_DOLLAR
}

/** `$18`, `$1.2k`: what a task costs, rounded the way a person reads money. */
export function formatDollars(microcents: number): string {
  const dollars = microcentsToDollars(microcents)
  if (dollars >= 1000) return `$${formatCount(dollars)}`
  if (dollars >= 10) return `$${Math.round(dollars)}`
  return `$${Math.round(dollars * 100) / 100}`
}

/** The numbers the goal and guardrail rows read, parsed from what the project stated. */
function goalNumbers(goals: GoalsAndGuardrails['goals'], id: string) {
  const goal = goals.find(g => g.id === id)
  return { statement: goal?.statement, target: goal?.metric?.target, current: goal?.metric?.current }
}

/**
 * One range per goal impact. The reference line is the change that would reach the target
 * (`target - current`), and only exists when the goal states both numbers.
 */
export function goalRows(impacts: GoalImpact[], project: GoalsAndGuardrails, rough: boolean): RangeRow[] {
  return impacts.map(impact => {
    const { statement, target, current } = goalNumbers(project.goals, impact.goalId)
    return {
      id: impact.goalId,
      statement: statement ?? impact.goalId,
      low: impact.low,
      high: impact.high,
      delta: rough ? null : impact.delta,
      ...(impact.unit ? { unit: impact.unit } : {}),
      reference: typeof target === 'number' && typeof current === 'number' ? target - current : null,
    }
  })
}

/**
 * One range per guardrail impact. The reference line is the headroom to the threshold
 * (`threshold - current`) when the guardrail has a fresh numeric reading to measure from.
 */
export function guardrailRows(impacts: GuardrailImpact[], project: GoalsAndGuardrails, rough: boolean): RangeRow[] {
  return impacts.map(impact => {
    const guardrail = project.guardrails.find(g => g.id === impact.guardrailId)
    const check = guardrail?.check?.type === 'metric' ? guardrail.check : null
    return {
      id: impact.guardrailId,
      statement: guardrail?.statement ?? impact.guardrailId,
      low: impact.low,
      high: impact.high,
      delta: rough ? null : impact.delta,
      ...(check?.unit ? { unit: check.unit } : {}),
      reference: check && typeof check.current === 'number' ? check.threshold - check.current : null,
      ...(!rough && impact.breachProbability !== undefined ? { breachProbability: impact.breachProbability } : {}),
    }
  })
}

/** The axis that holds every range and every reference line, with a little room either side. */
export function rangeDomain(rows: RangeRow[]): [number, number] {
  const values = rows.flatMap(row => [row.low, row.high, ...(row.reference === null ? [] : [row.reference])])
  values.push(0)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = (max - min) * 0.1 || 1
  return [min - pad, max + pad]
}

/** Where a value sits along the axis, 0 to 100, clamped to the axis. */
export function rangePercent(value: number, domain: [number, number]): number {
  const span = domain[1] - domain[0]
  if (!(span > 0)) return 50
  return Math.min(100, Math.max(0, ((value - domain[0]) / span) * 100))
}

export interface Opportunity {
  low: number
  high: number
  unit: string
  period: string
}

/**
 * Reach × impact, as a range: the people reached times the first goal's low and high change. Needs
 * both a reach and an impact; either missing is "not estimated", never a zero.
 */
export function opportunity(reach: EstimateReach | null, impacts: GoalImpact[]): Opportunity | null {
  const primary = impacts[0]
  if (!reach || !primary) return null
  return {
    low: primary.low * reach.count,
    high: primary.high * reach.count,
    unit: primary.unit ?? reach.unit,
    period: reach.period,
  }
}

export type AgeUnit = 'now' | 'minutes' | 'hours' | 'days'

/** How long ago, at the one unit that reads naturally. */
export function estimateAge(createdAt: string, now: Date): { unit: AgeUnit; n: number } {
  const ms = Math.max(0, now.getTime() - Date.parse(createdAt))
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return { unit: 'now', n: 0 }
  if (minutes < 60) return { unit: 'minutes', n: minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return { unit: 'hours', n: hours }
  return { unit: 'days', n: Math.floor(hours / 24) }
}

/** The labels the trade-off policy gives an estimate, in the order they rank (astrid-core `tradeoff::Label`). */
export const TRADEOFF_LABEL_ORDER = ['do-now', 'experiment-first', 'needs-review', 'dont'] as const

/** What the chip is: a known label, or nothing (a label a newer core adds is not guessed at). */
export function knownLabel(label: string | null | undefined): (typeof TRADEOFF_LABEL_ORDER)[number] | null {
  return (TRADEOFF_LABEL_ORDER as readonly string[]).includes(label ?? '') ? (label as (typeof TRADEOFF_LABEL_ORDER)[number]) : null
}

/** One reason line: the copy key's last part, its values, and which values are risk or confidence levels to translate. */
export interface ReasonLine {
  code: string
  values: Record<string, string>
  levels: string[]
}

const REASONS_WITH_NO_VALUES = new Set(['noEstimate', 'stale', 'riskUnknown', 'guardrailsUnknown', 'builtinCapped', 'noGoalImproves'])
const probability = (value: unknown) => (typeof value === 'number' ? String(Math.round(value * 100) / 100) : '')

/**
 * The reason lines for a stored label (docs/specs/GOALS_GUARDRAILS_SIGNALS.md → 6): the core's codes
 * with the numbers that produced them, so the client words each in its own strings and never
 * re-derives one. A code this client does not know is dropped rather than shown as a key.
 */
export function labelReasonLines(
  reasons: readonly { code: string; [key: string]: unknown }[] | null | undefined,
  project: GoalsAndGuardrails,
): ReasonLine[] {
  const lines: ReasonLine[] = []
  for (const reason of reasons ?? []) {
    const line = (values: Record<string, string>, levels: string[] = []) => lines.push({ code: reason.code, values, levels })
    switch (reason.code) {
      case 'guardrailAtRefuse':
      case 'guardrailAtReview': {
        const id = String(reason.guardrailId ?? '')
        line({
          name: project.guardrails.find(g => g.id === id)?.statement ?? id,
          probability: probability(reason.breachProbability),
          threshold: probability(reason.threshold),
        })
        break
      }
      case 'riskAtRefuse':
      case 'riskAtReview':
        line({ level: String(reason.level ?? ''), threshold: String(reason.threshold ?? '') }, ['level', 'threshold'])
        break
      case 'confidenceLow':
        line({})
        break
      case 'experimentFirst':
        line({ confidence: String(reason.confidence ?? ''), risk: String(reason.risk ?? '') }, ['confidence', 'risk'])
        break
      case 'goalImproves': {
        const id = String(reason.goalId ?? '')
        line({ name: project.goals.find(g => g.id === id)?.statement ?? id, delta: formatSigned(Number(reason.delta ?? 0)) })
        break
      }
      default:
        if (REASONS_WITH_NO_VALUES.has(reason.code)) line({})
    }
  }
  return lines
}

/** The estimator's `source` as a short key for copy: `builtin_llm`, `human`, or a service's own name. */
export function sourceKind(source: string): 'builtin' | 'human' | 'service' {
  if (source === 'builtin_llm') return 'builtin'
  if (source === 'human') return 'human'
  return 'service'
}
