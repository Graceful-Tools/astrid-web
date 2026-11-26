/**
 * Evaluating the trade-off policy on write (ADEV-281, docs/specs/GOALS_GUARDRAILS_SIGNALS.md → 6).
 *
 * The rule is astrid-core's (lib/core-rules/tradeoff-core.ts). Web stores the policy, runs the rule on
 * the server and stores the answer on the estimate row: `label`, `labelReasons`, `sortKey`,
 * `policyDigest`. A browser compares the stored keys and never evaluates.
 *
 * - **When an estimate arrives**, `evaluateEstimateRow` labels it against the policy that applies to
 *   its task: the project's, then the override of the task's list in that project.
 * - **When a policy changes**, `enqueueTradeoffReevaluation` queues a bounded walk over the project's
 *   latest estimates (a page of `REEVALUATE_PAGE_SIZE` tasks per job, each page queueing the next).
 *   A row whose `policyDigest` already matches is left alone, so a policy edit that changes nothing
 *   for a row costs one comparison.
 * - **No policy stated** means no label: the columns are written as null, with a digest that says
 *   "no policy", so a row labelled under an earlier policy is cleared by the walk, not left stale.
 */
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { enqueueJob } from '@/lib/jobs/queue'
import type { TradeoffReevaluatePayload } from '@/lib/jobs/kinds'
import { storedGoalsAndGuardrails } from '@/lib/goals-guardrails'
import { effectiveOrchestrationPolicy } from '@/lib/core-rules/orchestration-core'
import { evaluateTradeoff, type TradeoffEstimate } from '@/lib/core-rules/tradeoff-core'
import { parsePolicyOverride, type PolicyOverride } from '@/lib/orchestration-policy'

const log = createLogger('tradeoff-evaluation')

/** An estimate older than this is passed to the rule as stale, and needs review. */
export const ESTIMATE_STALE_AFTER_MS = 30 * 24 * 60 * 60_000
/** Tasks re-evaluated per job. A project with more is walked in several jobs. */
export const REEVALUATE_PAGE_SIZE = 100

type EstimateRow = Awaited<ReturnType<typeof prisma.taskEstimate.findFirstOrThrow>>

/** What the rule needs of a project besides the policy: which guardrails exist and which way each goal improves. */
interface ProjectInputs {
  guardrailsStated: boolean
  directions: Map<string, 'up' | 'down'>
  override: PolicyOverride | null
}

function storedOverride(value: unknown, where: string): PolicyOverride | null {
  const parsed = parsePolicyOverride(value)
  if (parsed.ok) return parsed.value
  log.error({ where, message: parsed.error.message }, 'Stored orchestration policy is not valid; reading it as nothing stored')
  return null
}

function projectInputs(project: { orchestrationPolicy: unknown; goalsAndGuardrails: unknown; id: string }): ProjectInputs {
  const stated = storedGoalsAndGuardrails(project.goalsAndGuardrails as never)
  const directions = new Map<string, 'up' | 'down'>()
  for (const goal of stated.goals) if (goal.metric?.direction) directions.set(goal.id, goal.metric.direction)
  return {
    guardrailsStated: stated.guardrails.length > 0,
    directions,
    override: storedOverride(project.orchestrationPolicy, `project ${project.id}`),
  }
}

/** The estimate as the core reads it. A guardrail impact with no probability is unknown, not a pass. */
export function tradeoffEstimateOf(row: EstimateRow, inputs: Pick<ProjectInputs, 'guardrailsStated' | 'directions'>, now: Date): TradeoffEstimate {
  const goalImpacts = (row.goalImpacts as unknown as { goalId: string; delta: number; low: number; high: number }[]) ?? []
  const guardrails = (row.guardrailImpacts as unknown as { guardrailId: string; breachProbability?: number }[]) ?? []
  const usable = guardrails.flatMap(g => (typeof g.breachProbability === 'number' ? [{ guardrailId: g.guardrailId, breachProbability: g.breachProbability }] : []))
  const risk = row.risk as unknown as { level?: 'low' | 'medium' | 'high' } | null
  return {
    goalImpacts: goalImpacts.map(g => ({
      goalId: g.goalId,
      delta: g.delta,
      low: g.low,
      high: g.high,
      ...(inputs.directions.has(g.goalId) ? { direction: inputs.directions.get(g.goalId) } : {}),
    })),
    guardrailImpacts: guardrails.length > 0 && usable.length === guardrails.length ? usable : null,
    risk: risk?.level ? { level: risk.level } : null,
    confidence: row.confidence as 'low' | 'medium' | 'high',
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    costMicrocents: row.costMicrocents === null ? null : Number(row.costMicrocents),
    stale: now.getTime() - row.createdAt.getTime() > ESTIMATE_STALE_AFTER_MS,
    guardrailsStated: inputs.guardrailsStated,
  }
}

/**
 * Names everything a stored answer depends on besides the estimate itself: the resolved trade-off
 * policy, whether the project states guardrails and the goals' directions. 40 hex, like the digests
 * approvals are bound to.
 */
export function policyDigestOf(tradeoff: unknown, inputs: Pick<ProjectInputs, 'guardrailsStated' | 'directions'>): string {
  const directions = [...inputs.directions.entries()].sort(([a], [b]) => a.localeCompare(b))
  return createHash('sha1')
    .update(canonicalJson({ tradeoff: tradeoff ?? null, guardrailsStated: inputs.guardrailsStated, directions }))
    .digest('hex')
}

/** JSON with object keys in sorted order, so the digest does not depend on the order an engine writes them in. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

interface Evaluated {
  label: string | null
  labelReasons: Prisma.InputJsonValue | typeof Prisma.DbNull
  sortKey: Prisma.InputJsonValue | typeof Prisma.DbNull
  policyDigest: string
}

/** The columns `row` should carry under `override` (the project's) and `listOverride`, or null when the core cannot answer. */
function evaluateRow(row: EstimateRow, inputs: ProjectInputs, listOverride: PolicyOverride | null, now: Date): Evaluated | null {
  const stored = { project: inputs.override, list: listOverride }
  const effective = effectiveOrchestrationPolicy(stored)
  if (!effective.ok) {
    log.error({ message: effective.error.message }, 'Orchestration policy did not resolve; leaving the estimate unlabelled')
    return null
  }
  const policyDigest = policyDigestOf(effective.value.tradeoff, inputs)
  const answer = evaluateTradeoff(stored, tradeoffEstimateOf(row, inputs, now))
  if (!answer) return null
  if (!answer.ok) {
    log.error({ message: answer.error.message }, 'Trade-off policy was refused by the rules; leaving the estimate unlabelled')
    return null
  }
  if (!answer.value) return { label: null, labelReasons: Prisma.DbNull, sortKey: Prisma.DbNull, policyDigest }
  return {
    label: answer.value.label,
    labelReasons: answer.value.reasons as unknown as Prisma.InputJsonValue,
    sortKey: answer.value.sortKey as unknown as Prisma.InputJsonValue,
    policyDigest,
  }
}

/** The override of the task's list in this project (the first by id, so the answer is stable). */
function listOverrideFor(lists: { id: string; projectId: string | null; orchestrationPolicy: unknown }[], projectId: string): PolicyOverride | null {
  const list = lists.filter(l => l.projectId === projectId).sort((a, b) => a.id.localeCompare(b.id))[0]
  return list ? storedOverride(list.orchestrationPolicy, `list ${list.id}`) : null
}

const PROJECT_SELECT = { id: true, orchestrationPolicy: true, goalsAndGuardrails: true } as const
const LIST_SELECT = { id: true, projectId: true, orchestrationPolicy: true } as const

/**
 * Label a freshly written estimate against the policy that applies to its task, and answer the row
 * as stored. Never throws: an estimate that cannot be evaluated is stored unlabelled, which is what
 * no policy stated looks like.
 */
export async function evaluateEstimateRow(row: EstimateRow): Promise<EstimateRow> {
  try {
    const [project, task] = await Promise.all([
      prisma.project.findUnique({ where: { id: row.projectId }, select: PROJECT_SELECT }),
      prisma.task.findUnique({ where: { id: row.taskId }, select: { lists: { select: LIST_SELECT } } }),
    ])
    if (!project || !task) return row
    const evaluated = evaluateRow(row, projectInputs(project), listOverrideFor(task.lists, project.id), new Date())
    if (!evaluated) return row
    return await prisma.taskEstimate.update({ where: { id: row.id }, data: evaluated })
  } catch (err) {
    log.error({ err, estimateId: row.id }, 'Could not evaluate the trade-off policy for an estimate')
    return row
  }
}

/**
 * A policy edit on a project (`listId` null) or on one of its lists: walk the project's latest
 * estimates and bring each to the new policy. Queued, never inline, so the edit's response does not
 * wait on a project's worth of rows.
 */
export async function enqueueTradeoffReevaluation(projectId: string | null, listId: string | null): Promise<void> {
  if (!projectId) return
  await enqueueJob('tradeoff-reevaluate', { projectId, listId, afterTaskId: null })
}

/** One page of the walk. Each page that fills queues the next, so no job is longer than a page. */
export async function runTradeoffReevaluationJob(payload: TradeoffReevaluatePayload): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: payload.projectId }, select: PROJECT_SELECT })
  if (!project) return
  const inputs = projectInputs(project)

  // The latest estimate of each task, in task order, one page after the cursor.
  const rows = await prisma.taskEstimate.findMany({
    where: {
      projectId: payload.projectId,
      ...(payload.afterTaskId ? { taskId: { gt: payload.afterTaskId } } : {}),
      ...(payload.listId ? { task: { lists: { some: { id: payload.listId } } } } : {}),
    },
    orderBy: [{ taskId: 'asc' }, { createdAt: 'desc' }],
    distinct: ['taskId'],
    take: REEVALUATE_PAGE_SIZE,
    include: { task: { select: { lists: { select: LIST_SELECT } } } },
  })

  const now = new Date()
  let changed = 0
  for (const { task, ...row } of rows) {
    const evaluated = evaluateRow(row, inputs, listOverrideFor(task.lists, project.id), now)
    if (!evaluated || evaluated.policyDigest === row.policyDigest) continue
    await prisma.taskEstimate.update({ where: { id: row.id }, data: evaluated })
    changed++
  }
  log.info({ projectId: payload.projectId, listId: payload.listId, page: rows.length, changed }, 'Re-evaluated a page of estimates')

  if (rows.length === REEVALUATE_PAGE_SIZE) {
    await enqueueJob('tradeoff-reevaluate', { ...payload, afterTaskId: rows[rows.length - 1].taskId })
  }
}
