/**
 * A project's goals and guardrails (ADEV-179): "goals and guardrails are better than guidance".
 *
 * A project states what it is trying to achieve (goals, each optionally with a measure, a target and
 * the current value) and what it must not do (guardrails). The people and the agents working in the
 * project read the same statement, so a prompt can stay short: the work goes toward the goals and
 * stays inside the guardrails.
 *
 * A guardrail is `stated` when a reader judges it ("Break no applicable laws") and `enforced` when a
 * program is meant to check it ("No more than 20% in one position"). Today `enforced` is a label;
 * the checks themselves are ADEV-182.
 *
 * Stored as Project.goalsAndGuardrails (JSON). This module is the one place the shape is read, so the
 * API, the agent prompts and the MCP tool agree; clients follow docs/API_CONTRACT.md. Safe for the
 * browser: no server imports.
 */

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
}

export interface ProjectGuardrail {
  id: string
  statement: string
  kind: GuardrailKind
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
const ID_MAX_CHARS = 40

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
    guardrails.push(id ? { id, statement, kind: kind as GuardrailKind } : { statement, kind: kind as GuardrailKind })
  }

  if (goals.length > GOALS_MAX) return { ok: false, error: `At most ${GOALS_MAX} goals` }
  if (guardrails.length > GUARDRAILS_MAX) return { ok: false, error: `At most ${GUARDRAILS_MAX} guardrails` }

  const dupGoal = duplicate(goals.map(g => g.id).filter((id): id is string => !!id))
  if (dupGoal) return { ok: false, error: `Goal ids must be unique: ${dupGoal}` }
  const dupGuardrail = duplicate(guardrails.map(r => r.id).filter((id): id is string => !!id))
  if (dupGuardrail) return { ok: false, error: `Guardrail ids must be unique: ${dupGuardrail}` }

  const withGoalIds = assignIds(goals, 'g').map(({ id, ...rest }) => ({ id, ...rest }))
  const withGuardrailIds = assignIds(guardrails, 'r').map(({ id, statement, kind }) => ({ id, statement, kind }))
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
