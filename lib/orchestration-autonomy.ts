/**
 * The orchestration policy's vocabulary (AWTD-1693): the autonomy values, the resolved policy's
 * shape, and how to read and compare autonomy. Split from lib/orchestration-policy.ts so the stdio
 * MCP server (mcp/orchestration-policy-tool.ts, compiled by `npm run build:mcp:oauth` without path
 * aliases and at ES2020) can use it without pulling in the rules mirror. No imports.
 */

export const AUTONOMY_VALUES = ['allowed', 'ask', 'never'] as const
export type Autonomy = (typeof AUTONOMY_VALUES)[number]

export const ESCALATION_TARGETS = ['listOwner', 'taskCreator', 'people'] as const
export type Escalation = { to: 'listOwner' } | { to: 'taskCreator' } | { to: 'people'; userIds: string[] }

/** The autonomy fields a policy decides, flattened for the settings UI and the skill text. */
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

/** The three-step scale risk and confidence are written in (astrid-core `tradeoff::Level`). */
export const LEVELS = ['low', 'medium', 'high'] as const
export type Level = (typeof LEVELS)[number]

/**
 * A trade-off policy with every field decided (ADEV-281; astrid-core `tradeoff::TradeoffPolicy`;
 * docs/specs/GOALS_GUARDRAILS_SIGNALS.md → 6). It is a key of the orchestration policy and is absent
 * until a person states one: with none, nothing is labelled and there is no policy sort.
 */
export interface TradeoffPolicy {
  goalOrder: string[]
  risk: { reviewAt: Level; refuseAt: Level }
  guardrail: { reviewAtBreachProbability: number; refuseAtBreachProbability: number }
  experimentFirst: { confidenceBelow: Level; riskAtLeast: Level }
  minConfidenceToAct: Level
}

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
  /** Absent when no project or list states one. */
  tradeoff?: TradeoffPolicy
}

const STRICTNESS: Record<Autonomy, number> = { allowed: 0, ask: 1, never: 2 }
export const stricterAutonomy = (a: Autonomy, b: Autonomy): Autonomy => (STRICTNESS[a] >= STRICTNESS[b] ? a : b)

/** One autonomy field of a policy, by its flattened name. */
export function autonomyFor(policy: OrchestrationPolicy, field: AutonomyField): Autonomy {
  if (field === 'migrateAdditive') return policy.autonomy.migrate.additive
  if (field === 'migrateDestructive') return policy.autonomy.migrate.destructive
  return policy.autonomy[field]
}
