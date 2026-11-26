/**
 * The orchestration policy's vocabulary (AWTD-1693): the autonomy values, the resolved policy's
 * shape, and how to read and compare autonomy. Split from lib/orchestration-policy.ts so the stdio
 * MCP server (mcp/orchestration-policy-tool.ts, compiled by `npm run build:mcp:oauth` without path
 * aliases and at ES2020) can use it without pulling in the rules mirror. No runtime imports: the one
 * import is a type from lib/task-estimate.ts, which imports nothing.
 */
import type { EstimateLevel } from './task-estimate'

export const AUTONOMY_VALUES = ['allowed', 'ask', 'never'] as const
export type Autonomy = (typeof AUTONOMY_VALUES)[number]

export const ESCALATION_TARGETS = ['listOwner', 'taskCreator', 'people'] as const
export type Escalation = { to: 'listOwner' } | { to: 'taskCreator' } | { to: 'people'; userIds: string[] }

/**
 * The autonomy fields the settings UI, the skill text and the guardrail checks show, flattened.
 * Includes the Goal signals actions (`promoteIdea`, `experimentStart`, `experimentStop`, ADEV-273),
 * which joined with their settings UI (ADEV-281).
 */
export const AUTONOMY_FIELDS = [
  'merge',
  'deploy',
  'migrateAdditive',
  'migrateDestructive',
  'release',
  'spend',
  'promoteIdea',
  'experimentStart',
  'experimentStop',
] as const
export type AutonomyField = (typeof AUTONOMY_FIELDS)[number]

export interface OrchestrationPolicy {
  routing: { assignTo: string | null; agents: string[] | null }
  autonomy: {
    merge: Autonomy
    deploy: Autonomy
    migrate: { additive: Autonomy; destructive: Autonomy }
    release: Autonomy
    spend: Autonomy
    promoteIdea: Autonomy
    experimentStart: Autonomy
    experimentStop: Autonomy
  }
  escalation: Escalation
  /** How an estimate is labelled and ordered. Absent when no layer stores one: no policy, no label (core T1). */
  tradeoff?: TradeoffPolicy
}

/** astrid-core's `tradeoff::Label`: what an estimate earns, most to least permissive. */
export const TRADEOFF_LABELS = ['do-now', 'experiment-first', 'needs-review', 'dont'] as const
export type TradeoffLabel = (typeof TRADEOFF_LABELS)[number]

/** astrid-core's `tradeoff::TradeoffPolicy`: a trade-off policy with every field decided (GOAL_SIGNALS.md §2). */
export interface TradeoffPolicy {
  /** The goals, most important first. */
  goalOrder: string[]
  risk: { reviewAt: EstimateLevel; refuseAt: EstimateLevel }
  guardrail: { reviewAtBreachProbability: number; refuseAtBreachProbability: number }
  experimentFirst: { confidenceBelow: EstimateLevel; riskAtLeast: EstimateLevel }
  /** The least confidence an agent may promote an idea on (`promoteIdea`'s floor). */
  minConfidenceToAct: EstimateLevel
}

const STRICTNESS: Record<Autonomy, number> = { allowed: 0, ask: 1, never: 2 }
export const stricterAutonomy = (a: Autonomy, b: Autonomy): Autonomy => (STRICTNESS[a] >= STRICTNESS[b] ? a : b)

/** One autonomy field of a policy, by its flattened name. */
export function autonomyFor(policy: OrchestrationPolicy, field: AutonomyField): Autonomy {
  if (field === 'migrateAdditive') return policy.autonomy.migrate.additive
  if (field === 'migrateDestructive') return policy.autonomy.migrate.destructive
  return policy.autonomy[field]
}
