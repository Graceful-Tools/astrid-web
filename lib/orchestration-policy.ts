/**
 * The orchestration policy (AWTD-1693): who takes a board's unassigned Ready work, what an agent
 * may do on its own (merge, deploy, migrate, release, spend), and who it asks.
 *
 * **Core-first.** astrid-core owns the rules (`astrid_rules::orchestration`, AWTD-1685; design in
 * its docs/ORCHESTRATION_POLICY.md, decision CONTRACTS.md D71). The server asks them through
 * lib/core-rules/orchestration-core.ts. This file is:
 *
 * - **The shapes and the write-side validation.** A `PolicyOverride` is stored on `Project` and
 *   another on `TaskList`. Every key is optional, and an absent key inherits. A bad value
 *   (`"merge": "sometimes"`) is refused, never read as `allowed`.
 * - **The TypeScript mirror** of the four rules-door kinds (`orchestrationPolicy`,
 *   `orchestrationRoute`, `orchestrationMay`, `orchestrationEscalate`). The server falls back to it
 *   while the vendored core build predates the rules (packages/astrid-rules/REVISION, ADEV-23). It
 *   is held to every case of the core's fixture by tests/lib/orchestration-policy-awtd-1693.test.ts.
 *
 * Browser-safe: no Node imports, no Prisma.
 */
import { handBackTs } from '@/lib/waiting-rules'

export const AUTONOMY_VALUES = ['allowed', 'ask', 'never'] as const
export type Autonomy = (typeof AUTONOMY_VALUES)[number]

export const ORCHESTRATION_ACTIONS = ['merge', 'deploy', 'migrate', 'release', 'spend'] as const
export type OrchestrationAction = (typeof ORCHESTRATION_ACTIONS)[number]

export const MIGRATION_KINDS = ['additive', 'destructive'] as const
export type MigrationKind = (typeof MIGRATION_KINDS)[number]

export const ESCALATION_TARGETS = ['listOwner', 'taskCreator', 'people'] as const
export type Escalation = { to: 'listOwner' } | { to: 'taskCreator' } | { to: 'people'; userIds: string[] }

/** The autonomy fields a policy decides, flattened for the settings UI and the skill text. */
export const AUTONOMY_FIELDS = ['merge', 'deploy', 'migrateAdditive', 'migrateDestructive', 'release', 'spend'] as const
export type AutonomyField = (typeof AUTONOMY_FIELDS)[number]

export interface PolicyOverride {
  routing?: { assignTo?: string | null; agents?: string[] | null }
  autonomy?: {
    merge?: Autonomy
    deploy?: Autonomy
    migrate?: { additive?: Autonomy; destructive?: Autonomy }
    release?: Autonomy
    spend?: Autonomy
  }
  escalation?: Escalation
}

export interface OrchestrationPolicy {
  routing: { assignTo: string | null; agents: string[] | null }
  autonomy: {
    merge: Autonomy
    deploy: Autonomy
    migrate: { additive: Autonomy; destructive: Autonomy }
    release: Autonomy
    spend: Autonomy
  }
  escalation: Escalation
}

export type RouteReason = 'routed' | 'routedElsewhere' | 'anyAdmittedAgent' | 'notAdmitted'
export type MayReason = 'policy' | 'destructiveFloor' | 'unclassifiedMigration' | 'notAdmitted'

export interface RouteAnswer { take: boolean; reason: RouteReason }
export interface MayAnswer { decision: Autonomy; mustAsk: boolean; reason: MayReason }
export interface EscalationAnswer {
  notify: string[]
  handBack: { statusRole: null; assigneeId: string; completed: false }
}

/** The rules door's envelope: `{ ok, value }` or `{ ok: false, error }`. */
export type OrchestrationAnswer<T> =
  | { ok: true; value: T }
  | { ok: false; error: { kind: 'badRequest'; message: string } }

/** A request to one of the four door kinds, carrying the overrides exactly as stored. */
export type OrchestrationRequest =
  | { kind: 'orchestrationPolicy'; project?: unknown; list?: unknown }
  | { kind: 'orchestrationRoute'; project?: unknown; list?: unknown; agent: string }
  | {
      kind: 'orchestrationMay'
      project?: unknown
      list?: unknown
      agent: string
      action: OrchestrationAction
      migration?: MigrationKind | null
    }
  | { kind: 'orchestrationEscalate'; project?: unknown; list?: unknown; listOwnerId: string; taskCreatorId?: string | null }

/** O2: nothing stored is today's behaviour. Every action needs a person, any agent claims, questions go to the list owner. */
export function defaultOrchestrationPolicy(): OrchestrationPolicy {
  return {
    routing: { assignTo: null, agents: null },
    autonomy: {
      merge: 'never',
      deploy: 'never',
      migrate: { additive: 'never', destructive: 'never' },
      release: 'never',
      spend: 'never',
    },
    escalation: { to: 'listOwner' },
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

class PolicyError extends Error {}

const quoted = (values: readonly string[]) => values.map(value => `\`${value}\``).join(', ')

/** The core's (serde's) wording, so the mirror refuses with the same message the core does. */
function variant<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
  if (typeof value !== 'string') throw new PolicyError(`invalid type: expected one of ${quoted(allowed)}`)
  throw new PolicyError(`unknown variant \`${value}\`, expected one of ${quoted(allowed)}`)
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PolicyError(`invalid type: \`${field}\` must be an object`)
  }
  return value as Record<string, unknown>
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[], field: string) {
  const unknown = Object.keys(value).find(key => !keys.includes(key))
  if (unknown) throw new PolicyError(`unknown field \`${unknown}\` in \`${field}\`, expected one of ${quoted(keys)}`)
}

function name(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new PolicyError(`invalid type: \`${field}\` must be a non-empty string`)
  return value
}

function names(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new PolicyError(`invalid type: \`${field}\` must be an array of strings`)
  return value.map(item => name(item, field))
}

function autonomyOf(raw: Record<string, unknown>, key: string, into: Record<string, unknown>) {
  if (raw[key] !== undefined) into[key] = variant(raw[key], AUTONOMY_VALUES)
}

function escalationOf(value: unknown): Escalation {
  const raw = record(value, 'escalation')
  const to = variant(raw.to, ESCALATION_TARGETS)
  if (to !== 'people') {
    onlyKeys(raw, ['to'], 'escalation')
    return { to }
  }
  onlyKeys(raw, ['to', 'userIds'], 'escalation')
  if (raw.userIds === undefined) throw new PolicyError('missing field `userIds`')
  return { to, userIds: names(raw.userIds, 'escalation.userIds') }
}

function overrideOf(value: unknown): PolicyOverride | null {
  if (value === null || value === undefined) return null
  const raw = record(value, 'policy')
  onlyKeys(raw, ['routing', 'autonomy', 'escalation'], 'policy')
  const result: PolicyOverride = {}

  if (raw.routing !== undefined) {
    const routing = record(raw.routing, 'routing')
    onlyKeys(routing, ['assignTo', 'agents'], 'routing')
    const out: NonNullable<PolicyOverride['routing']> = {}
    // `null` is a value ("any agent") and overrides an inherited agent; only an absent key inherits.
    if (Object.hasOwn(routing, 'assignTo')) out.assignTo = routing.assignTo === null ? null : name(routing.assignTo, 'routing.assignTo')
    if (Object.hasOwn(routing, 'agents')) out.agents = routing.agents === null ? null : names(routing.agents, 'routing.agents')
    if (Object.keys(out).length) result.routing = out
  }

  if (raw.autonomy !== undefined) {
    const autonomy = record(raw.autonomy, 'autonomy')
    onlyKeys(autonomy, ['merge', 'deploy', 'migrate', 'release', 'spend'], 'autonomy')
    const out: Record<string, unknown> = {}
    for (const key of ['merge', 'deploy', 'release', 'spend']) autonomyOf(autonomy, key, out)
    if (autonomy.migrate !== undefined) {
      const migrate = record(autonomy.migrate, 'autonomy.migrate')
      onlyKeys(migrate, MIGRATION_KINDS, 'autonomy.migrate')
      const kinds: Record<string, unknown> = {}
      for (const kind of MIGRATION_KINDS) autonomyOf(migrate, kind, kinds)
      if (Object.keys(kinds).length) out.migrate = kinds
    }
    if (Object.keys(out).length) result.autonomy = out as PolicyOverride['autonomy']
  }

  if (raw.escalation !== undefined && raw.escalation !== null) result.escalation = escalationOf(raw.escalation)

  return Object.keys(result).length ? result : null
}

/**
 * Validate a stored or submitted override. Answers its canonical form: empty groups dropped, and
 * `null` for an override that says nothing (store `null`, so "nothing stored" stays one value).
 */
export function parsePolicyOverride(value: unknown): OrchestrationAnswer<PolicyOverride | null> {
  try {
    return { ok: true, value: overrideOf(value) }
  } catch (error) {
    if (error instanceof PolicyError) return { ok: false, error: { kind: 'badRequest', message: error.message } }
    throw error
  }
}

// ── The rules (the mirror) ───────────────────────────────────────────────────

/** Case and surrounding space never decide which agent a name means. */
export function sameAgent(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function layer(policy: OrchestrationPolicy, override: PolicyOverride | null): OrchestrationPolicy {
  if (!override) return policy
  const next: OrchestrationPolicy = {
    routing: { ...policy.routing },
    autonomy: { ...policy.autonomy, migrate: { ...policy.autonomy.migrate } },
    escalation: policy.escalation,
  }
  const routing = override.routing ?? {}
  if (Object.hasOwn(routing, 'assignTo')) next.routing.assignTo = routing.assignTo ?? null
  if (Object.hasOwn(routing, 'agents')) next.routing.agents = routing.agents ?? null
  const autonomy = override.autonomy ?? {}
  for (const key of ['merge', 'deploy', 'release', 'spend'] as const) {
    if (autonomy[key]) next.autonomy[key] = autonomy[key]
  }
  for (const kind of MIGRATION_KINDS) {
    const value = autonomy.migrate?.[kind]
    if (value) next.autonomy.migrate[kind] = value
  }
  if (override.escalation) next.escalation = override.escalation
  return next
}

/** O1: the default, then the project's override, then the list's, field by field. */
export function resolvePolicy(project: PolicyOverride | null, list: PolicyOverride | null): OrchestrationPolicy {
  return layer(layer(defaultOrchestrationPolicy(), project), list)
}

function admits(policy: OrchestrationPolicy, agent: string): boolean {
  const routed = policy.routing.assignTo !== null && sameAgent(policy.routing.assignTo, agent)
  return routed || policy.routing.agents === null || policy.routing.agents.some(admitted => sameAgent(admitted, agent))
}

/** O3: may this agent take an unassigned Ready task on this list? */
export function routeAgent(policy: OrchestrationPolicy, agent: string): RouteAnswer {
  const routed = policy.routing.assignTo
  if (routed !== null) return sameAgent(routed, agent) ? { take: true, reason: 'routed' } : { take: false, reason: 'routedElsewhere' }
  return admits(policy, agent) ? { take: true, reason: 'anyAdmittedAgent' } : { take: false, reason: 'notAdmitted' }
}

const STRICTNESS: Record<Autonomy, number> = { allowed: 0, ask: 1, never: 2 }
export const stricterAutonomy = (a: Autonomy, b: Autonomy): Autonomy => (STRICTNESS[a] >= STRICTNESS[b] ? a : b)

/**
 * O4: what this agent may do alone. A destructive migration is never freer than an additive one,
 * and a migration of unstated kind is answered as destructive.
 */
export function mayAgent(
  policy: OrchestrationPolicy,
  agent: string,
  action: OrchestrationAction,
  migration?: MigrationKind | null,
): MayAnswer {
  const answer = (decision: Autonomy, reason: MayReason): MayAnswer => ({ decision, mustAsk: decision === 'ask', reason })
  if (!admits(policy, agent)) return answer('never', 'notAdmitted')
  const a = policy.autonomy
  if (action !== 'migrate') return answer(a[action], 'policy')
  if (migration === 'additive') return answer(a.migrate.additive, 'policy')
  const floored = stricterAutonomy(a.migrate.destructive, a.migrate.additive)
  const reason: MayReason = !migration ? 'unclassifiedMigration' : floored !== a.migrate.destructive ? 'destructiveFloor' : 'policy'
  return answer(floored, reason)
}

/** O5: who receives a question, in order and without repeats; the first is who the task goes back to. */
export function escalateTo(policy: OrchestrationPolicy, listOwnerId: string, taskCreatorId?: string | null): EscalationAnswer {
  const e = policy.escalation
  const named = e.to === 'listOwner' ? [listOwnerId] : e.to === 'taskCreator' ? [taskCreatorId ?? listOwnerId] : e.userIds
  const notify: string[] = []
  for (const person of named.map(id => id.trim())) {
    if (person && !notify.includes(person)) notify.push(person)
  }
  if (notify.length === 0) notify.push(listOwnerId)
  return { notify, handBack: handBackTs(notify[0]) }
}

/** The mirror's answer to one rules-door request, in the door's envelope. */
export function runOrchestrationTs(request: OrchestrationRequest): OrchestrationAnswer<unknown> {
  const project = parsePolicyOverride(request.project)
  if (!project.ok) return project
  const list = parsePolicyOverride(request.list)
  if (!list.ok) return list
  const policy = resolvePolicy(project.value, list.value)
  try {
    switch (request.kind) {
      case 'orchestrationPolicy':
        return { ok: true, value: policy }
      case 'orchestrationRoute':
        return { ok: true, value: routeAgent(policy, request.agent) }
      case 'orchestrationMay': {
        const action = variant(request.action, ORCHESTRATION_ACTIONS)
        const migration = request.migration == null ? null : variant(request.migration, MIGRATION_KINDS)
        return { ok: true, value: mayAgent(policy, request.agent, action, migration) }
      }
      case 'orchestrationEscalate':
        return { ok: true, value: escalateTo(policy, request.listOwnerId, request.taskCreatorId) }
    }
  } catch (error) {
    if (error instanceof PolicyError) return { ok: false, error: { kind: 'badRequest', message: error.message } }
    throw error
  }
}

// ── Reading a policy ─────────────────────────────────────────────────────────

/** One autonomy field of a policy, by its flattened name. */
export function autonomyFor(policy: OrchestrationPolicy, field: AutonomyField): Autonomy {
  if (field === 'migrateAdditive') return policy.autonomy.migrate.additive
  if (field === 'migrateDestructive') return policy.autonomy.migrate.destructive
  return policy.autonomy[field]
}

/** One autonomy field of an override, or undefined when it inherits. */
export function overrideAutonomyFor(override: PolicyOverride | null, field: AutonomyField): Autonomy | undefined {
  const a = override?.autonomy
  if (field === 'migrateAdditive') return a?.migrate?.additive
  if (field === 'migrateDestructive') return a?.migrate?.destructive
  return a?.[field]
}

/** A copy of `override` with one autonomy field set, or removed (inherit) when `value` is undefined. */
export function withAutonomy(override: PolicyOverride | null, field: AutonomyField, value: Autonomy | undefined): PolicyOverride | null {
  const autonomy = { ...(override?.autonomy ?? {}) }
  const migrate = { ...(autonomy.migrate ?? {}) }
  const kind = field === 'migrateAdditive' ? 'additive' : field === 'migrateDestructive' ? 'destructive' : null
  if (kind) {
    if (value) migrate[kind] = value
    else delete migrate[kind]
    if (Object.keys(migrate).length) autonomy.migrate = migrate
    else delete autonomy.migrate
  } else {
    const key = field as Exclude<AutonomyField, 'migrateAdditive' | 'migrateDestructive'>
    if (value) autonomy[key] = value
    else delete autonomy[key]
  }
  const next: PolicyOverride = { ...(override ?? {}), autonomy }
  if (!Object.keys(autonomy).length) delete next.autonomy
  return parseCanonical(next)
}

/** A copy of `override` with `routing.assignTo` set (a mailbox, or null for any agent), or inheriting when undefined. */
export function withAssignTo(override: PolicyOverride | null, value: string | null | undefined): PolicyOverride | null {
  const routing = { ...(override?.routing ?? {}) }
  if (value === undefined) delete routing.assignTo
  else routing.assignTo = value
  const next: PolicyOverride = { ...(override ?? {}), routing }
  if (!Object.keys(routing).length) delete next.routing
  return parseCanonical(next)
}

/** A copy of `override` with its escalation target set, or inheriting when undefined. */
export function withEscalation(override: PolicyOverride | null, value: Escalation | undefined): PolicyOverride | null {
  const next: PolicyOverride = { ...(override ?? {}) }
  if (value) next.escalation = value
  else delete next.escalation
  return parseCanonical(next)
}

function parseCanonical(value: PolicyOverride): PolicyOverride | null {
  const parsed = parsePolicyOverride(value)
  return parsed.ok ? parsed.value : null
}
