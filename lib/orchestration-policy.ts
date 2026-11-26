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
 *   `orchestrationRoute`, `orchestrationMay`, `orchestrationEscalate`). The server asks the core and
 *   falls back to this only if the vendored build cannot answer; the settings UI uses it because
 *   the browser package does not carry these kinds. It is held to every case of the core's fixture by tests/lib/orchestration-policy-awtd-1693.test.ts.
 *
 * Browser-safe: no Node imports, no Prisma.
 */
import { handBackTs } from '@/lib/waiting-rules'
import {
  AUTONOMY_VALUES,
  ESCALATION_TARGETS,
  LEVELS,
  stricterAutonomy,
  type Autonomy,
  type AutonomyField,
  type Escalation,
  type Level,
  type OrchestrationPolicy,
  type TradeoffPolicy,
} from '@/lib/orchestration-autonomy'

export {
  AUTONOMY_FIELDS,
  AUTONOMY_VALUES,
  ESCALATION_TARGETS,
  LEVELS,
  autonomyFor,
  stricterAutonomy,
  type Autonomy,
  type AutonomyField,
  type Escalation,
  type Level,
  type OrchestrationPolicy,
  type TradeoffPolicy,
} from '@/lib/orchestration-autonomy'

export const ORCHESTRATION_ACTIONS = [
  'merge',
  'deploy',
  'migrate',
  'release',
  'spend',
  'promoteIdea',
  'experimentStart',
  'experimentStop',
] as const
export type OrchestrationAction = (typeof ORCHESTRATION_ACTIONS)[number]

export const MIGRATION_KINDS = ['additive', 'destructive'] as const
export type MigrationKind = (typeof MIGRATION_KINDS)[number]

export interface PolicyOverride {
  routing?: { assignTo?: string | null; agents?: string[] | null }
  autonomy?: {
    merge?: Autonomy
    deploy?: Autonomy
    migrate?: { additive?: Autonomy; destructive?: Autonomy }
    release?: Autonomy
    spend?: Autonomy
    promoteIdea?: Autonomy
    experimentStart?: Autonomy
    experimentStop?: Autonomy
  }
  escalation?: Escalation
  tradeoff?: TradeoffOverride
}

/** What a project or a list stores under `tradeoff`: any subset of a {@link TradeoffPolicy}. */
export interface TradeoffOverride {
  goalOrder?: string[]
  risk?: { reviewAt?: Level; refuseAt?: Level }
  guardrail?: { reviewAtBreachProbability?: number; refuseAtBreachProbability?: number }
  experimentFirst?: { confidenceBelow?: Level; riskAtLeast?: Level }
  minConfidenceToAct?: Level
}

/** The label an estimate earns (astrid-core `tradeoff::Label`), most permissive first. */
export const TRADEOFF_LABELS = ['do-now', 'experiment-first', 'needs-review', 'dont'] as const
export type TradeoffLabel = (typeof TRADEOFF_LABELS)[number]

export type RouteReason = 'routed' | 'routedElsewhere' | 'anyAdmittedAgent' | 'notAdmitted'
export type MayReason =
  | 'policy'
  | 'destructiveFloor'
  | 'unclassifiedMigration'
  | 'notAdmitted'
  | 'noEstimate'
  | 'notDoNow'
  | 'belowConfidence'

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
      /** `promoteIdea` only: the label the estimate earned and the estimator's confidence. */
      label?: TradeoffLabel | null
      confidence?: Level | null
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
      promoteIdea: 'never',
      experimentStart: 'never',
      experimentStop: 'never',
    },
    escalation: { to: 'listOwner' },
  }
}

/** What a stored `tradeoff` key inherits where it names less than all of it. Not a policy by itself: with no key stored anywhere there is none. */
export function defaultTradeoffPolicy(): TradeoffPolicy {
  return {
    goalOrder: [],
    risk: { reviewAt: 'medium', refuseAt: 'high' },
    guardrail: { reviewAtBreachProbability: 0.1, refuseAtBreachProbability: 0.5 },
    experimentFirst: { confidenceBelow: 'medium', riskAtLeast: 'medium' },
    minConfidenceToAct: 'medium',
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

function levelOf(raw: Record<string, unknown>, key: string, into: Record<string, unknown>) {
  if (raw[key] !== undefined) into[key] = variant(raw[key], LEVELS)
}

/** The core's wording for a probability outside 0–1 (`tradeoff::Probability`). */
function probability(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) throw new PolicyError('invalid type: expected a number between 0 and 1')
  if (!(value >= 0 && value <= 1)) throw new PolicyError(`${value} is not a probability between 0 and 1`)
  return value
}

function tradeoffOf(value: unknown): TradeoffOverride {
  const raw = record(value, 'tradeoff')
  onlyKeys(raw, ['goalOrder', 'risk', 'guardrail', 'experimentFirst', 'minConfidenceToAct'], 'tradeoff')
  const out: TradeoffOverride = {}
  if (raw.goalOrder !== undefined) out.goalOrder = names(raw.goalOrder, 'tradeoff.goalOrder')
  if (raw.risk !== undefined) {
    const risk = record(raw.risk, 'tradeoff.risk')
    onlyKeys(risk, ['reviewAt', 'refuseAt'], 'tradeoff.risk')
    const fields: Record<string, unknown> = {}
    levelOf(risk, 'reviewAt', fields)
    levelOf(risk, 'refuseAt', fields)
    if (Object.keys(fields).length) out.risk = fields as TradeoffOverride['risk']
  }
  if (raw.guardrail !== undefined) {
    const guardrail = record(raw.guardrail, 'tradeoff.guardrail')
    onlyKeys(guardrail, ['reviewAtBreachProbability', 'refuseAtBreachProbability'], 'tradeoff.guardrail')
    const fields: Record<string, number> = {}
    for (const key of ['reviewAtBreachProbability', 'refuseAtBreachProbability']) {
      if (guardrail[key] !== undefined) fields[key] = probability(guardrail[key])
    }
    if (Object.keys(fields).length) out.guardrail = fields
  }
  if (raw.experimentFirst !== undefined) {
    const experiment = record(raw.experimentFirst, 'tradeoff.experimentFirst')
    onlyKeys(experiment, ['confidenceBelow', 'riskAtLeast'], 'tradeoff.experimentFirst')
    const fields: Record<string, unknown> = {}
    levelOf(experiment, 'confidenceBelow', fields)
    levelOf(experiment, 'riskAtLeast', fields)
    if (Object.keys(fields).length) out.experimentFirst = fields as TradeoffOverride['experimentFirst']
  }
  if (raw.minConfidenceToAct !== undefined) out.minConfidenceToAct = variant(raw.minConfidenceToAct, LEVELS)
  // An empty key still states a policy (the defaults), as it does in the core: it is kept as `{}`.
  return out
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
  onlyKeys(raw, ['routing', 'autonomy', 'escalation', 'tradeoff'], 'policy')
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
    onlyKeys(autonomy, ['merge', 'deploy', 'migrate', 'release', 'spend', 'promoteIdea', 'experimentStart', 'experimentStop'], 'autonomy')
    const out: Record<string, unknown> = {}
    for (const key of ['merge', 'deploy', 'release', 'spend', 'promoteIdea', 'experimentStart', 'experimentStop']) autonomyOf(autonomy, key, out)
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
  if (raw.tradeoff !== undefined && raw.tradeoff !== null) result.tradeoff = tradeoffOf(raw.tradeoff)

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
    ...(policy.tradeoff ? { tradeoff: policy.tradeoff } : {}),
  }
  const routing = override.routing ?? {}
  if (Object.hasOwn(routing, 'assignTo')) next.routing.assignTo = routing.assignTo ?? null
  if (Object.hasOwn(routing, 'agents')) next.routing.agents = routing.agents ?? null
  const autonomy = override.autonomy ?? {}
  for (const key of ['merge', 'deploy', 'release', 'spend', 'promoteIdea', 'experimentStart', 'experimentStop'] as const) {
    if (autonomy[key]) next.autonomy[key] = autonomy[key]
  }
  for (const kind of MIGRATION_KINDS) {
    const value = autonomy.migrate?.[kind]
    if (value) next.autonomy.migrate[kind] = value
  }
  if (override.escalation) next.escalation = override.escalation
  if (override.tradeoff) next.tradeoff = layerTradeoff(policy.tradeoff ?? defaultTradeoffPolicy(), override.tradeoff)
  return next
}

/** `tradeoff::TradeoffPolicy::with`: the override laid over the policy, field by field. */
function layerTradeoff(policy: TradeoffPolicy, override: TradeoffOverride): TradeoffPolicy {
  return {
    goalOrder: override.goalOrder ?? policy.goalOrder,
    risk: { ...policy.risk, ...override.risk },
    guardrail: { ...policy.guardrail, ...override.guardrail },
    experimentFirst: { ...policy.experimentFirst, ...override.experimentFirst },
    minConfidenceToAct: override.minConfidenceToAct ?? policy.minConfidenceToAct,
  }
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

/**
 * O4: what this agent may do alone. A destructive migration is never freer than an additive one,
 * and a migration of unstated kind is answered as destructive.
 */
export function mayAgent(
  policy: OrchestrationPolicy,
  agent: string,
  action: OrchestrationAction,
  migration?: MigrationKind | null,
  estimate?: { label?: TradeoffLabel | null; confidence?: Level | null } | null,
): MayAnswer {
  const answer = (decision: Autonomy, reason: MayReason): MayAnswer => ({ decision, mustAsk: decision === 'ask', reason })
  if (!admits(policy, agent)) return answer('never', 'notAdmitted')
  const a = policy.autonomy
  if (action === 'promoteIdea') {
    // Never unless the estimate is `do-now` and as confident as the policy asks; no estimate is never.
    const bar = (policy.tradeoff ?? defaultTradeoffPolicy()).minConfidenceToAct
    if (!estimate?.label || !estimate.confidence) return answer('never', 'noEstimate')
    if (estimate.label !== 'do-now') return answer('never', 'notDoNow')
    if (LEVELS.indexOf(estimate.confidence) < LEVELS.indexOf(bar)) return answer('never', 'belowConfidence')
    return answer(a.promoteIdea, 'policy')
  }
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
        const label = request.label == null ? null : variant(request.label, TRADEOFF_LABELS)
        const confidence = request.confidence == null ? null : variant(request.confidence, LEVELS)
        return { ok: true, value: mayAgent(policy, request.agent, action, migration, { label, confidence }) }
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

/** The trade-off thresholds the settings UI edits one at a time, flattened like the autonomy fields. */
export const TRADEOFF_LEVEL_FIELDS = ['riskReviewAt', 'riskRefuseAt', 'confidenceBelow', 'experimentRiskAtLeast', 'minConfidenceToAct'] as const
export const TRADEOFF_PROBABILITY_FIELDS = ['guardrailReview', 'guardrailRefuse'] as const
export type TradeoffLevelField = (typeof TRADEOFF_LEVEL_FIELDS)[number]
export type TradeoffProbabilityField = (typeof TRADEOFF_PROBABILITY_FIELDS)[number]
export type TradeoffField = TradeoffLevelField | TradeoffProbabilityField

/** One threshold of a resolved trade-off policy, by its flattened name. */
export function tradeoffFor(policy: TradeoffPolicy, field: TradeoffLevelField): Level
export function tradeoffFor(policy: TradeoffPolicy, field: TradeoffProbabilityField): number
export function tradeoffFor(policy: TradeoffPolicy, field: TradeoffField): Level | number {
  switch (field) {
    case 'riskReviewAt': return policy.risk.reviewAt
    case 'riskRefuseAt': return policy.risk.refuseAt
    case 'confidenceBelow': return policy.experimentFirst.confidenceBelow
    case 'experimentRiskAtLeast': return policy.experimentFirst.riskAtLeast
    case 'minConfidenceToAct': return policy.minConfidenceToAct
    case 'guardrailReview': return policy.guardrail.reviewAtBreachProbability
    case 'guardrailRefuse': return policy.guardrail.refuseAtBreachProbability
  }
}

/** One threshold an override states, or undefined when it inherits. */
export function overrideTradeoffFor(override: PolicyOverride | null, field: TradeoffField): Level | number | undefined {
  const t = override?.tradeoff
  switch (field) {
    case 'riskReviewAt': return t?.risk?.reviewAt
    case 'riskRefuseAt': return t?.risk?.refuseAt
    case 'confidenceBelow': return t?.experimentFirst?.confidenceBelow
    case 'experimentRiskAtLeast': return t?.experimentFirst?.riskAtLeast
    case 'minConfidenceToAct': return t?.minConfidenceToAct
    case 'guardrailReview': return t?.guardrail?.reviewAtBreachProbability
    case 'guardrailRefuse': return t?.guardrail?.refuseAtBreachProbability
  }
}

/**
 * A copy of `override` with one trade-off threshold set, or inheriting when `value` is undefined.
 * Setting one states a policy (the other fields take the defaults); clearing the last leaves `{}`,
 * which still states one. Only `withTradeoffStated(…, false)` takes the policy away.
 */
export function withTradeoffField(override: PolicyOverride | null, field: TradeoffField, value: Level | number | undefined): PolicyOverride | null {
  const t: TradeoffOverride = {
    ...(override?.tradeoff ?? {}),
    risk: { ...(override?.tradeoff?.risk ?? {}) },
    guardrail: { ...(override?.tradeoff?.guardrail ?? {}) },
    experimentFirst: { ...(override?.tradeoff?.experimentFirst ?? {}) },
  }
  const put = <T extends object, K extends keyof T>(group: T, key: K) => {
    if (value === undefined) delete group[key]
    else group[key] = value as T[K]
  }
  switch (field) {
    case 'riskReviewAt': put(t.risk!, 'reviewAt'); break
    case 'riskRefuseAt': put(t.risk!, 'refuseAt'); break
    case 'confidenceBelow': put(t.experimentFirst!, 'confidenceBelow'); break
    case 'experimentRiskAtLeast': put(t.experimentFirst!, 'riskAtLeast'); break
    case 'minConfidenceToAct': put(t, 'minConfidenceToAct'); break
    case 'guardrailReview': put(t.guardrail!, 'reviewAtBreachProbability'); break
    case 'guardrailRefuse': put(t.guardrail!, 'refuseAtBreachProbability'); break
  }
  for (const group of ['risk', 'guardrail', 'experimentFirst'] as const) {
    if (!Object.keys(t[group] ?? {}).length) delete t[group]
  }
  return parseCanonical({ ...(override ?? {}), tradeoff: t })
}

/** A copy of `override` with the goal order set (most important first), or inheriting when undefined. */
export function withGoalOrder(override: PolicyOverride | null, order: string[] | undefined): PolicyOverride | null {
  const t: TradeoffOverride = { ...(override?.tradeoff ?? {}) }
  if (order === undefined) delete t.goalOrder
  else t.goalOrder = order
  return parseCanonical({ ...(override ?? {}), tradeoff: t })
}

/** A copy of `override` that states a trade-off policy (the defaults) or states none. */
export function withTradeoffStated(override: PolicyOverride | null, stated: boolean): PolicyOverride | null {
  const next: PolicyOverride = { ...(override ?? {}) }
  if (stated) next.tradeoff = next.tradeoff ?? {}
  else delete next.tradeoff
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
