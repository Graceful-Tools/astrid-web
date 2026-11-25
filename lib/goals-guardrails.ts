/**
 * A project's goals and guardrails (ADEV-179): "goals and guardrails are better than guidance".
 *
 * A project states what it is trying to achieve (goals, each optionally with a measure, a target and
 * the current value) and what it must not do (guardrails). The people and the agents working in the
 * project read the same statement, so a prompt can stay short: the work goes toward the goals and
 * stays inside the guardrails.
 *
 * A guardrail is `stated` when a reader judges it ("Break no applicable laws") and `enforced` when a
 * program checks it ("No more than 20% in one position"). An enforced guardrail may carry a `check`
 * a program can evaluate (ADEV-182): today a policy check, "agents may not do X alone", read against
 * the board's orchestration policy; a violated one blocks the action. An enforced guardrail with no
 * check yet is still a label.
 *
 * A goal's `current` value changes over time (ADEV-182). Each change by a person, an agent or a
 * script is kept in the goal's short `history` with who and when, so progress toward `target` shows.
 *
 * Stored as Project.goalsAndGuardrails (JSON). This module is the one place the shape is read, so the
 * API, the agent prompts and the MCP tool agree; clients follow docs/API_CONTRACT.md. Safe for the
 * browser: no server imports.
 */

import { AUTONOMY_FIELDS, autonomyFor, stricterAutonomy, type AutonomyField, type OrchestrationPolicy } from './orchestration-autonomy'

export const GUARDRAIL_KINDS = ['stated', 'enforced'] as const
export type GuardrailKind = (typeof GUARDRAIL_KINDS)[number]

export interface ProjectGoal {
  id: string
  statement: string
  /** What is measured, e.g. "IRR". */
  measure?: string
  /** Where the measure should get to, e.g. "≥ 8%/yr". */
  target?: string
  /** Where it is now, e.g. "6.1%". */
  current?: string
  /** The latest changes to `current`, oldest first. Written by the server, never by the editor. */
  history?: GoalMeasurement[]
  /**
   * The typed number behind the free text (ADEV-270). Absent on a goal that is only prose, which then
   * reads exactly as before. `null` is only ever a submitted "clear it" (see `parseGoalsAndGuardrails`);
   * nothing stores it.
   */
  metric?: GoalMetric | null
}

/** A goal's measure as numbers, with an optional outside source to read it from. */
export interface GoalMetric {
  unit?: string
  /** Which way is better. */
  direction: 'up' | 'down'
  target?: number
  baseline?: number
  /** Written by the server. */
  current?: number
  /** ISO timestamp. Written by the server. */
  measuredAt?: string
  source?: { connectorId: string; metricKey: string }
  /** How old `current` may get before it is unknown. Default 48. */
  staleAfterHours?: number
}

export const GOAL_MEASUREMENT_SOURCES = ['human', 'agent', 'push', 'pull'] as const
export type GoalMeasurementSource = (typeof GOAL_MEASUREMENT_SOURCES)[number]

/** One recorded change of a goal's `current` value. */
export interface GoalMeasurement {
  value: string
  /** Who recorded it: a user id or an agent mailbox. */
  by: string
  /** ISO timestamp. */
  at: string
  /** The task whose work moved it, when there is one. */
  taskId?: string
  /** The number, when the value reads as one. */
  num?: number
  source?: GoalMeasurementSource
  /** The sender's id for this reading; a repeat of one already in the history is a no-op. */
  externalId?: string
}

/**
 * A machine check behind an enforced guardrail. `policy`: agents may not do `field` more freely than
 * `atLeast` (the board's orchestration policy must be `ask` or `never` for it). Custom checks a
 * script evaluates are a later `type`.
 */
export interface PolicyGuardrailCheck {
  type: 'policy'
  field: AutonomyField
  atLeast: 'ask' | 'never'
}
export type GuardrailCheck = PolicyGuardrailCheck

export interface ProjectGuardrail {
  id: string
  statement: string
  kind: GuardrailKind
  check?: GuardrailCheck
}

export interface GoalsAndGuardrails {
  goals: ProjectGoal[]
  guardrails: ProjectGuardrail[]
}

export const EMPTY_GOALS_AND_GUARDRAILS: GoalsAndGuardrails = Object.freeze({
  goals: [],
  guardrails: [],
}) as GoalsAndGuardrails

/** Enough for a real project; a longer list is guidance in disguise. */
export const GOALS_MAX = 12
export const GUARDRAILS_MAX = 20
export const STATEMENT_MAX_CHARS = 500
export const FIELD_MAX_CHARS = 120
export const GOAL_HISTORY_MAX = 20
const ID_MAX_CHARS = 40
const EXTERNAL_ID_MAX_CHARS = 120

export type ParseResult = { ok: true; value: GoalsAndGuardrails } | { ok: false; error: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function text(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t : undefined
}

/** Fill missing ids as g1, g2… (or r1…), skipping any id the writer already used. */
function assignIds<T extends { id?: string }>(items: T[], prefix: string): Array<T & { id: string }> {
  const taken = new Set(items.map(i => i.id).filter((id): id is string => !!id))
  let n = 0
  return items.map(item => {
    if (item.id) return item as T & { id: string }
    let id: string
    do id = `${prefix}${++n}`
    while (taken.has(id))
    taken.add(id)
    return { ...item, id }
  })
}

function duplicate(ids: string[]): string | null {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) return id
    seen.add(id)
  }
  return null
}

function parseHistory(raw: unknown): GoalMeasurement[] | null {
  if (!Array.isArray(raw)) return null
  const out: GoalMeasurement[] = []
  for (const m of raw) {
    if (!isRecord(m)) return null
    const value = text(m.value)
    const by = text(m.by)
    const at = text(m.at)
    if (!value || !by || !at || Number.isNaN(Date.parse(at))) return null
    const taskId = text(m.taskId)
    const externalId = text(m.externalId)
    out.push({
      value: value.slice(0, FIELD_MAX_CHARS),
      by: by.slice(0, ID_MAX_CHARS),
      at,
      ...(taskId ? { taskId: taskId.slice(0, ID_MAX_CHARS) } : {}),
      ...(finite(m.num) ? { num: m.num } : {}),
      ...(GOAL_MEASUREMENT_SOURCES.includes(m.source as GoalMeasurementSource) ? { source: m.source as GoalMeasurementSource } : {}),
      ...(externalId ? { externalId: externalId.slice(0, EXTERNAL_ID_MAX_CHARS) } : {}),
    })
  }
  return out.slice(-GOAL_HISTORY_MAX)
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Read a submitted metric block, or null when it is not one. Unknown keys are dropped. */
function parseMetric(raw: unknown): GoalMetric | null {
  if (!isRecord(raw)) return null
  if (raw.direction !== 'up' && raw.direction !== 'down') return null
  const metric: GoalMetric = { direction: raw.direction }
  const unit = text(raw.unit)
  if (unit) metric.unit = unit.slice(0, FIELD_MAX_CHARS)
  for (const key of ['target', 'baseline', 'current'] as const) {
    if (raw[key] === undefined || raw[key] === null) continue
    if (!finite(raw[key])) return null
    metric[key] = raw[key] as number
  }
  const measuredAt = text(raw.measuredAt)
  if (measuredAt) {
    if (Number.isNaN(Date.parse(measuredAt))) return null
    metric.measuredAt = measuredAt
  }
  if (raw.source !== undefined && raw.source !== null) {
    if (!isRecord(raw.source)) return null
    const connectorId = text(raw.source.connectorId)
    const metricKey = text(raw.source.metricKey)
    if (!connectorId || !metricKey) return null
    metric.source = { connectorId: connectorId.slice(0, ID_MAX_CHARS), metricKey: metricKey.slice(0, FIELD_MAX_CHARS) }
  }
  if (raw.staleAfterHours !== undefined && raw.staleAfterHours !== null) {
    if (!finite(raw.staleAfterHours) || raw.staleAfterHours <= 0) return null
    metric.staleAfterHours = raw.staleAfterHours
  }
  return metric
}

function parseCheck(raw: unknown): GuardrailCheck | null {
  if (!isRecord(raw) || raw.type !== 'policy') return null
  if (!AUTONOMY_FIELDS.includes(raw.field as AutonomyField)) return null
  if (raw.atLeast !== 'ask' && raw.atLeast !== 'never') return null
  return { type: 'policy', field: raw.field as AutonomyField, atLeast: raw.atLeast }
}

/**
 * Read a submitted `{ goals, guardrails }`: trims every field, drops blank items and empty optional
 * fields, defaults a guardrail's kind to `stated`, and gives each item a stable id. Refuses the wrong
 * shape, an unknown kind, a duplicate id, and more than the limits.
 */
export function parseGoalsAndGuardrails(raw: unknown): ParseResult {
  if (raw === null || raw === undefined) return { ok: true, value: EMPTY_GOALS_AND_GUARDRAILS }
  if (!isRecord(raw)) return { ok: false, error: 'Expected { goals, guardrails }' }
  const goalsIn = raw.goals ?? []
  const guardrailsIn = raw.guardrails ?? []
  if (!Array.isArray(goalsIn) || !Array.isArray(guardrailsIn)) {
    return { ok: false, error: 'goals and guardrails are lists' }
  }

  const goals: Array<Omit<ProjectGoal, 'id'> & { id?: string }> = []
  for (const g of goalsIn) {
    if (!isRecord(g)) return { ok: false, error: 'Each goal is { statement, measure?, target?, current? }' }
    const statement = text(g.statement)
    if (!statement) continue
    if (statement.length > STATEMENT_MAX_CHARS) return { ok: false, error: `A goal is at most ${STATEMENT_MAX_CHARS} characters` }
    const goal: Omit<ProjectGoal, 'id'> & { id?: string } = { statement }
    const id = text(g.id)
    if (id) {
      if (id.length > ID_MAX_CHARS) return { ok: false, error: `An id is at most ${ID_MAX_CHARS} characters` }
      goal.id = id
    }
    for (const field of ['measure', 'target', 'current'] as const) {
      const value = text(g[field])
      if (!value) continue
      if (value.length > FIELD_MAX_CHARS) return { ok: false, error: `A goal's ${field} is at most ${FIELD_MAX_CHARS} characters` }
      goal[field] = value
    }
    if (g.history !== undefined) {
      const history = parseHistory(g.history)
      if (!history) return { ok: false, error: "A goal's history is a list of { value, by, at }" }
      if (history.length) goal.history = history
    }
    if (g.metric === null) goal.metric = null
    else if (g.metric !== undefined) {
      const metric = parseMetric(g.metric)
      if (!metric) return { ok: false, error: `A goal's metric is { direction: "up"|"down", unit?, target?, baseline?, source?, staleAfterHours? }` }
      goal.metric = metric
    }
    // Keep a stable key order (id first) so stored JSON and the fixture read the same everywhere.
    goals.push(goal.id ? { id: goal.id, ...goal } : goal)
  }

  const guardrails: Array<Omit<ProjectGuardrail, 'id'> & { id?: string }> = []
  for (const r of guardrailsIn) {
    if (!isRecord(r)) return { ok: false, error: 'Each guardrail is { statement, kind? }' }
    const statement = text(r.statement)
    if (!statement) continue
    if (statement.length > STATEMENT_MAX_CHARS) return { ok: false, error: `A guardrail is at most ${STATEMENT_MAX_CHARS} characters` }
    const kind = r.kind === undefined || r.kind === null ? 'stated' : r.kind
    if (!GUARDRAIL_KINDS.includes(kind as GuardrailKind)) return { ok: false, error: 'A guardrail kind is "stated" or "enforced"' }
    const id = text(r.id)
    if (id && id.length > ID_MAX_CHARS) return { ok: false, error: `An id is at most ${ID_MAX_CHARS} characters` }
    const entry: Omit<ProjectGuardrail, 'id'> & { id?: string } = { statement, kind: kind as GuardrailKind }
    if (r.check !== undefined && r.check !== null) {
      if (kind !== 'enforced') return { ok: false, error: 'Only an enforced guardrail can have a check' }
      const check = parseCheck(r.check)
      if (!check) return { ok: false, error: `A check is { type: "policy", field: ${AUTONOMY_FIELDS.join('|')}, atLeast: "ask"|"never" }` }
      entry.check = check
    }
    guardrails.push(id ? { id, ...entry } : entry)
  }

  if (goals.length > GOALS_MAX) return { ok: false, error: `At most ${GOALS_MAX} goals` }
  if (guardrails.length > GUARDRAILS_MAX) return { ok: false, error: `At most ${GUARDRAILS_MAX} guardrails` }

  const dupGoal = duplicate(goals.map(g => g.id).filter((id): id is string => !!id))
  if (dupGoal) return { ok: false, error: `Goal ids must be unique: ${dupGoal}` }
  const dupGuardrail = duplicate(guardrails.map(r => r.id).filter((id): id is string => !!id))
  if (dupGuardrail) return { ok: false, error: `Guardrail ids must be unique: ${dupGuardrail}` }

  const withGoalIds = assignIds(goals, 'g').map(({ id, ...rest }) => ({ id, ...rest }))
  const withGuardrailIds = assignIds(guardrails, 'r').map(({ id, statement, kind, check }) => ({
    id,
    statement,
    kind,
    ...(check ? { check } : {}),
  }))
  return { ok: true, value: { goals: withGoalIds, guardrails: withGuardrailIds } }
}

/** What is stored, read leniently: anything unreadable is nothing stated, never an error. */
export function storedGoalsAndGuardrails(json: unknown): GoalsAndGuardrails {
  const parsed = parseGoalsAndGuardrails(json)
  return parsed.ok ? parsed.value : EMPTY_GOALS_AND_GUARDRAILS
}

export function hasGoalsOrGuardrails(value: GoalsAndGuardrails): boolean {
  return value.goals.length > 0 || value.guardrails.length > 0
}

/** One goal's measure, target and current value as a short phrase, or '' when it has none. */
export function goalMeasurePhrase(goal: ProjectGoal): string {
  return [
    goal.measure && `measure: ${goal.measure}`,
    goal.target && `target: ${goal.target}`,
    goal.current && `current: ${goal.current}`,
  ]
    .filter(Boolean)
    .join('; ')
}

/**
 * The statement as markdown, for an agent's prompt and for plain-text readers. Ids are shown so an
 * agent can say which goal its work served (ADEV-182). Empty when nothing is stated.
 */
export function formatGoalsForAgent(value: GoalsAndGuardrails): string {
  const sections: string[] = []
  if (value.goals.length) {
    sections.push(
      ['## Goals', ...value.goals.map(g => {
        const measure = goalMeasurePhrase(g)
        return `- [${g.id}] ${g.statement}${measure ? ` (${measure})` : ''}`
      })].join('\n'),
    )
  }
  if (value.guardrails.length) {
    sections.push(
      ['## Guardrails', ...value.guardrails.map(r => `- [${r.id}] ${r.statement}${r.kind === 'enforced' ? ' (enforced)' : ''}`)].join('\n'),
    )
  }
  return sections.join('\n\n')
}

/**
 * The Prisma `select` fragment that loads a list's project goals, for nesting inside a list select
 * wherever an agent's payload or prompt is built from `task.lists[0]`.
 */
export const LIST_PROJECT_GOALS_SELECT = {
  project: { select: { id: true, name: true, goalsAndGuardrails: true } },
} as const

/**
 * The stated goals of the project a task's first list is in (the list agents already read guidance
 * from), or null when it is in no project, nothing is stated, or the project was not loaded.
 */
export function goalsOfFirstList(
  task: { lists?: Array<{ project?: { goalsAndGuardrails?: unknown } | null }> | null },
): GoalsAndGuardrails | null {
  const stored = task.lists?.[0]?.project?.goalsAndGuardrails
  if (stored === undefined || stored === null) return null
  const value = storedGoalsAndGuardrails(stored)
  return hasGoalsOrGuardrails(value) ? value : null
}

/**
 * Record a new `current` value for a goal (ADEV-182), who and when. A value equal to the present one
 * records nothing. Returns a new goal; the history keeps the latest GOAL_HISTORY_MAX changes.
 */
export function withMeasurement(
  goal: ProjectGoal,
  value: string,
  by: string,
  at: Date,
  taskId?: string,
  extra: { num?: number; source?: GoalMeasurementSource; externalId?: string } = {},
): ProjectGoal {
  const next = value.trim().slice(0, FIELD_MAX_CHARS)
  if (!next || next === goal.current) return goal
  // A prose goal keeps today's entry shape; the number is only read where a metric wants one.
  const num = extra.num ?? (goal.metric ? firstNumber(next) ?? undefined : undefined)
  const entry: GoalMeasurement = {
    value: next,
    by,
    at: at.toISOString(),
    ...(taskId ? { taskId } : {}),
    ...(num !== undefined ? { num } : {}),
    ...(extra.source ? { source: extra.source } : {}),
    ...(extra.externalId ? { externalId: extra.externalId } : {}),
  }
  const metric = goal.metric && num !== undefined ? { ...goal.metric, current: num, measuredAt: entry.at } : goal.metric
  return {
    ...goal,
    current: next,
    ...(metric ? { metric } : {}),
    history: [...(goal.history ?? []), entry].slice(-GOAL_HISTORY_MAX),
  }
}

function firstNumber(v: string | undefined): number | null {
  const m = v?.match(/-?\d+(?:[.,]\d+)?/)
  return m ? Number(m[0].replace(',', '.')) : null
}

/**
 * How far a goal's `current` is toward its `target`, when both read as numbers. A "≤" or "<" target
 * is met when current is at or below it (no percent); otherwise higher is better and `percent` is
 * current/target, capped at 100. Null when either side has no number, so a prose measure shows none.
 */
export function goalProgress(
  goal: Pick<ProjectGoal, 'target' | 'current'> & { metric?: GoalMetric | null },
): { met: boolean; percent: number | null } | null {
  // A metric block with both numbers wins (ADEV-270); direction `down` reads like a "≤" target.
  const metric = goal.metric && finite(goal.metric.target) && finite(goal.metric.current) ? goal.metric : null
  const target = metric ? metric.target! : firstNumber(goal.target)
  const current = metric ? metric.current! : firstNumber(goal.current)
  if (target === null || current === null) return null
  const lowerIsBetter = metric ? metric.direction === 'down' : /^\s*(≤|<=|<|at most|max)/i.test(goal.target ?? '')
  if (lowerIsBetter) return { met: current <= target, percent: null }
  if (target <= 0) return { met: current >= target, percent: null }
  return { met: current >= target, percent: Math.max(0, Math.min(100, Math.round((current / target) * 100))) }
}

/** Default hours before a goal's `current` reads as stale (spec: metric.staleAfterHours). */
export const GOAL_STALE_AFTER_HOURS = 48

/**
 * How fresh a goal's server-written reading is (ADEV-276): the reading time and whether it is older
 * than `staleAfterHours`. Null when the goal has no timestamped reading, so nothing is drawn for it.
 */
export function goalFreshness(
  goal: Pick<ProjectGoal, 'history'> & { metric?: GoalMetric | null },
  now: number = Date.now(),
): { measuredAt: string; ageMs: number; stale: boolean } | null {
  const latest = goal.history?.length ? goal.history[goal.history.length - 1].at : undefined
  const measuredAt = goal.metric?.measuredAt ?? latest
  if (!measuredAt) return null
  const time = Date.parse(measuredAt)
  if (Number.isNaN(time)) return null
  const ageMs = Math.max(0, now - time)
  const limitHours = goal.metric?.staleAfterHours
  const hours = typeof limitHours === 'number' && limitHours > 0 ? limitHours : GOAL_STALE_AFTER_HOURS
  return { measuredAt, ageMs, stale: ageMs > hours * 3_600_000 }
}

/** The numeric readings in a goal's history, oldest first, for a sparkline. */
export function goalSparkValues(goal: Pick<ProjectGoal, 'history'>): number[] {
  return (goal.history ?? []).map(m => m.num).filter(finite)
}

/**
 * The goal ids a work report names with a line of its own: `GOAL: g1` or `GOAL: g1, g2`. Agents put
 * it in a completion or handback comment so a project can show the work per goal (ADEV-182).
 */
export function goalIdsServed(report: string): string[] {
  const ids = new Set<string>()
  for (const line of report.split(/\r?\n/)) {
    const m = line.match(/^\s*GOAL:\s*(.+?)\s*$/)
    if (!m) continue
    for (const id of m[1].split(/[\s,]+/)) {
      const clean = id.replace(/^\[|\]$/g, '')
      if (clean) ids.add(clean)
    }
  }
  return [...ids]
}

export interface GuardrailViolation {
  guardrailId: string
  statement: string
  reason: string
}

/**
 * The enforced guardrails the policy breaks for an action (ADEV-182). `fields` are the autonomy
 * fields the action touches (a deploy is `deploy`; a migration is `migrateAdditive` or
 * `migrateDestructive`). A policy guardrail is violated when the effective policy lets agents do the
 * field more freely than `atLeast`. Stated guardrails, and enforced ones with no check, are not
 * evaluated here.
 */
export function guardrailViolations(
  guardrails: ProjectGuardrail[],
  policy: OrchestrationPolicy,
  fields: AutonomyField[],
): GuardrailViolation[] {
  const out: GuardrailViolation[] = []
  for (const rail of guardrails) {
    const check = rail.check
    if (rail.kind !== 'enforced' || !check || !fields.includes(check.field)) continue
    const actual = autonomyFor(policy, check.field)
    if (stricterAutonomy(actual, check.atLeast) === actual) continue
    out.push({
      guardrailId: rail.id,
      statement: rail.statement,
      reason: `the policy lets agents ${check.field} (${actual}) but this guardrail needs ${check.atLeast}`,
    })
  }
  return out
}
