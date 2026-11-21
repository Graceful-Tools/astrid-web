/**
 * A project's goals and guardrails (ADEV-179): what it is trying to achieve, and what it must not
 * do. People and agents work toward the goals inside the guardrails, so a prompt can stay minimal.
 *
 * One structured value on `Project.goalsAndGuardrails`. This module is the single place that
 * parses, normalises and formats it, shared by the API, the agent prompts, MCP and the settings UI.
 * Its wire shape is fixed for every client by the `goals.json` contract fixture.
 *
 * - A goal has a `statement` and may carry a `measure` ("IRR"), a `target` ("≥ 8%/yr") and the
 *   `current` reading.
 * - A guardrail is `stated` (judged by whoever reads it: "Break no applicable laws") or `enforced`
 *   (checked by a program; today the orchestration policy toggles).
 *
 * Browser-safe: no Node imports, no Prisma.
 */

export const GUARDRAIL_KINDS = ['stated', 'enforced'] as const
export type GuardrailKind = (typeof GUARDRAIL_KINDS)[number]

export const MAX_GOALS = 20
export const MAX_GUARDRAILS = 30
export const STATEMENT_MAX_CHARS = 500
export const FIELD_MAX_CHARS = 120

export interface Goal {
  id: string
  statement: string
  measure?: string
  target?: string
  current?: string
}

export interface Guardrail {
  id: string
  statement: string
  kind: GuardrailKind
}

export interface GoalsAndGuardrails {
  goals: Goal[]
  guardrails: Guardrail[]
}

export type GoalsParse = { ok: true; value: GoalsAndGuardrails | null } | { ok: false; error: string }

export function isEmptyGoals(value: GoalsAndGuardrails | null | undefined): boolean {
  return !value || (value.goals.length === 0 && value.guardrails.length === 0)
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

type TextResult = { ok: true; value?: string } | { ok: false; error: string }

function text(value: unknown, field: string, max: number, required: boolean): TextResult {
  if (value === undefined || value === null || value === '') {
    return required ? { ok: false, error: `${field} is required` } : { ok: true }
  }
  if (typeof value !== 'string') return { ok: false, error: `${field} must be text` }
  const trimmed = value.trim()
  if (!trimmed) return required ? { ok: false, error: `${field} is required` } : { ok: true }
  if (trimmed.length > max) return { ok: false, error: `${field} is longer than ${max} characters` }
  return { ok: true, value: trimmed }
}

/**
 * Validate a submitted value, normalised: text trimmed, empty optional fields dropped, ids unique.
 * `null`, or nothing in either list, is "nothing stated" and answers `{ ok: true, value: null }`.
 * A bad value is refused, never repaired quietly.
 */
export function parseGoalsAndGuardrails(input: unknown): GoalsParse {
  if (input === null || input === undefined) return { ok: true, value: null }
  if (!isObject(input)) return { ok: false, error: 'goals and guardrails must be an object' }
  const rawGoals = input.goals ?? []
  const rawGuardrails = input.guardrails ?? []
  if (!Array.isArray(rawGoals)) return { ok: false, error: 'goals must be a list' }
  if (!Array.isArray(rawGuardrails)) return { ok: false, error: 'guardrails must be a list' }
  if (rawGoals.length > MAX_GOALS) return { ok: false, error: `at most ${MAX_GOALS} goals` }
  if (rawGuardrails.length > MAX_GUARDRAILS) return { ok: false, error: `at most ${MAX_GUARDRAILS} guardrails` }

  const ids = new Set<string>()
  const idOf = (raw: Record<string, unknown>, where: string): { ok: true; id: string } | { ok: false; error: string } => {
    const id = text(raw.id, `${where} id`, FIELD_MAX_CHARS, true)
    if (!id.ok) return id
    if (ids.has(id.value!)) return { ok: false, error: `${where} id "${id.value}" is used twice` }
    ids.add(id.value!)
    return { ok: true, id: id.value! }
  }

  const goals: Goal[] = []
  for (const [index, raw] of rawGoals.entries()) {
    const where = `goal ${index + 1}`
    if (!isObject(raw)) return { ok: false, error: `${where} must be an object` }
    const id = idOf(raw, where)
    if (!id.ok) return id
    const statement = text(raw.statement, `${where} statement`, STATEMENT_MAX_CHARS, true)
    if (!statement.ok) return statement
    const goal: Goal = { id: id.id, statement: statement.value! }
    for (const key of ['measure', 'target', 'current'] as const) {
      const field = text(raw[key], `${where} ${key}`, FIELD_MAX_CHARS, false)
      if (!field.ok) return field
      if (field.value) goal[key] = field.value
    }
    goals.push(goal)
  }

  const guardrails: Guardrail[] = []
  for (const [index, raw] of rawGuardrails.entries()) {
    const where = `guardrail ${index + 1}`
    if (!isObject(raw)) return { ok: false, error: `${where} must be an object` }
    const id = idOf(raw, where)
    if (!id.ok) return id
    const statement = text(raw.statement, `${where} statement`, STATEMENT_MAX_CHARS, true)
    if (!statement.ok) return statement
    const kind = raw.kind ?? 'stated'
    if (!GUARDRAIL_KINDS.includes(kind as GuardrailKind)) {
      return { ok: false, error: `${where} kind must be one of ${GUARDRAIL_KINDS.join(', ')}` }
    }
    guardrails.push({ id: id.id, statement: statement.value!, kind: kind as GuardrailKind })
  }

  return { ok: true, value: goals.length || guardrails.length ? { goals, guardrails } : null }
}

/** A stored value read back. A row that no longer validates reads as nothing stated. */
export function readStoredGoals(value: unknown): GoalsAndGuardrails | null {
  const parsed = parseGoalsAndGuardrails(value)
  return parsed.ok ? parsed.value : null
}

/** "IRR: 6% → ≥ 8%/yr", or whichever parts the goal carries. */
export function formatGoalMeasure(goal: Goal): string {
  const { measure, target, current } = goal
  const progress = current && target ? `${current} → ${target}` : (current ?? target ?? '')
  if (measure && progress) return `${measure}: ${progress}`
  return measure ?? progress
}

/**
 * The plain-text block agents read, beside list guidance. Empty string when nothing is stated.
 * It is user-authored, so callers wrap it as untrusted data (lib/ai/prompt-trust.ts).
 */
export function formatGoalsForAgent(value: GoalsAndGuardrails | null | undefined): string {
  if (!value || isEmptyGoals(value)) return ''
  const lines: string[] = []
  if (value.goals.length) {
    lines.push('Goals (work toward these):')
    for (const goal of value.goals) {
      const measure = formatGoalMeasure(goal)
      lines.push(`- ${goal.statement}${measure ? ` (${measure})` : ''}`)
    }
  }
  if (value.guardrails.length) {
    if (lines.length) lines.push('')
    lines.push('Guardrails (never cross these):')
    for (const guardrail of value.guardrails) {
      lines.push(`- ${guardrail.statement}${guardrail.kind === 'enforced' ? ' [enforced by the system]' : ''}`)
    }
  }
  return lines.join('\n')
}
