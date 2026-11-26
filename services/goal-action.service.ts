/**
 * Acting on a label (ADEV-284, docs/specs/GOALS_GUARDRAILS_SIGNALS.md → 6 → Acting on a label).
 *
 * Three actions join the orchestration policy's autonomy: `promoteIdea` (a `do-now` idea goes from
 * Ideas to Ready), `experimentStart` and `experimentStop` (the experiment service's
 * `/experiments/action`). What the board's policy answers decides what the server does:
 *
 * - `allowed`: the server does it, and says so on the task.
 * - `ask`: the server posts an approval card (lib/approvals.ts) bound to the action and a 40-hex digest
 *   of the estimate or experiment snapshot; Approve runs exactly that (`carryOutApprovedGoalAction`).
 *   A newer estimate or snapshot has a different digest and needs a new card.
 * - `never` (the default): nothing happens; the recommendation stays a recommendation.
 *
 * **It fails closed.** A policy that does not resolve, a rules answer that is not an answer, a missing
 * estimate or connector: nothing acts. An estimate from the built-in model never acts, and neither
 * does one below the policy's `minConfidenceToAct` (the rule's own answer, `mayAgent`).
 */
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { orchestrationMay } from '@/lib/core-rules/orchestration-core'
import { ESTIMATE_LEVELS } from '@/lib/task-estimate'
import { parsePolicyOverride, type EstimateRef, type OrchestrationAction } from '@/lib/orchestration-policy'
import { TRADEOFF_LABELS, type TradeoffLabel } from '@/lib/orchestration-autonomy'
import { postExperimentAction } from '@/lib/experiment-source-client'
import { isOpenExperiment } from '@/lib/task-experiment'
import { type ApprovalRequest, type GoalAction } from '@/lib/approvals'
import { requestApproval } from '@/services/approval.service'
import { sourceTargetFor } from '@/services/project-connectors.service'
import { updateTaskWithSideEffects } from '@/services/task.service'

const log = createLogger('goal-action')

/** The agent name the server's own acts are asked under (the policy's routing may exclude it). */
export const SERVER_ACTOR = 'astrid-server'
/** `approvedBy` on an experiment action nobody had to approve. */
export const POLICY_APPROVER = 'policy'
/** Comment type for what the server did on its own, and the line that makes it findable. */
export const GOAL_ACTION_COMMENT = 'GOAL_ACTION'

export type GoalActionOutcome =
  | { status: 'acted'; action: GoalAction }
  | { status: 'asked'; action: GoalAction; commentId: string }
  /** Nothing ran: `never`, below the bar, a built-in estimate, nothing to act on, or the policy did not resolve. */
  | { status: 'recommendation'; action: GoalAction; reason: string }
  | { status: 'failed'; action: GoalAction; reason: string }

export type CarryOutResult = { ok: true } | { ok: false; status: 404 | 409 | 502; error: string; code: string }

const sha1 = (...parts: (string | null | undefined)[]) => createHash('sha1').update(parts.map(p => p ?? '').join('\u0000')).digest('hex')

type EstimateRow = NonNullable<Awaited<ReturnType<typeof latestEstimate>>>
type ExperimentRow = Awaited<ReturnType<typeof prisma.taskExperiment.findFirstOrThrow>>

const latestEstimate = (taskId: string) => prisma.taskEstimate.findFirst({ where: { taskId }, orderBy: { createdAt: 'desc' } })

/** Names the estimate and the policy it was labelled under: a new estimate or a changed policy is a new digest. */
export const estimateDigest = (row: Pick<EstimateRow, 'id' | 'label' | 'policyDigest'>) => sha1(row.id, row.label, row.policyDigest)

/** Names what the service reported: a refresh that changes nothing the person would decide on keeps the digest. */
export const experimentDigest = (row: Pick<ExperimentRow, 'id' | 'state' | 'verdict' | 'recommendation'>, action: GoalAction) =>
  sha1(row.id, action, row.state, row.verdict, JSON.stringify(row.recommendation ?? null))

function estimateRefOf(row: Pick<EstimateRow, 'label' | 'confidence'>): EstimateRef | null {
  const label = TRADEOFF_LABELS.find(l => l === row.label)
  const confidence = ESTIMATE_LEVELS.find(l => l === row.confidence)
  return label && confidence ? { label: label as TradeoffLabel, confidence } : null
}

interface Subject {
  projectId: string
  /** What a card is bound to. */
  digest: string
  /** For `promoteIdea`: the estimate the rule reads. Experiments have none. */
  estimate: EstimateRef | null
  summary: string
  run: (approvedBy: string) => Promise<CarryOutResult>
}

/** The policy overrides as stored: the project's, and the override of the task's list in that project. */
async function storedPolicy(taskId: string, projectId: string) {
  const [project, task] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { ownerId: true, orchestrationPolicy: true } }),
    prisma.task.findUnique({ where: { id: taskId }, select: { lists: { select: { id: true, projectId: true, orchestrationPolicy: true } } } }),
  ])
  if (!project || !task) return null
  const list = task.lists.filter(l => l.projectId === projectId).sort((a, b) => a.id.localeCompare(b.id))[0]
  const valid = (value: unknown) => {
    const parsed = parsePolicyOverride(value)
    return parsed.ok ? { value: parsed.value } : null
  }
  const stored = valid(project.orchestrationPolicy)
  const listStored = list ? valid(list.orchestrationPolicy) : { value: null }
  // A stored policy that does not parse is not "nothing stored": it could have said `never`.
  if (!stored || !listStored) return null
  return { ownerId: project.ownerId, project: stored.value, list: listStored.value }
}

async function postSystemComment(taskId: string, content: string) {
  await prisma.comment.create({ data: { taskId, authorId: null, content, type: 'MARKDOWN', systemEventType: GOAL_ACTION_COMMENT } })
}

// ── The subjects ──────────────────────────────────────────────────────────────

async function promoteSubject(taskId: string): Promise<Subject | string> {
  const [estimate, task] = await Promise.all([
    latestEstimate(taskId),
    prisma.task.findUnique({ where: { id: taskId }, select: { statusRole: true, completed: true, title: true } }),
  ])
  if (!task) return 'The task no longer exists'
  if (!estimate) return 'There is no estimate'
  // An estimate from the built-in model is a rough guess: it never acts (spec §6).
  if (estimate.source === 'builtin_llm') return 'A built-in estimate never acts'
  const ref = estimateRefOf(estimate)
  if (!ref) return 'The estimate has no label'
  return {
    projectId: estimate.projectId,
    digest: estimateDigest(estimate),
    estimate: ref,
    summary: `Move this idea to Ready. Its estimate is labelled **${ref.label}** with ${ref.confidence} confidence.`,
    run: async approvedBy => {
      // The idea must still be an idea: a person may have moved or finished it while the card waited.
      if (task.statusRole !== null || task.completed) {
        return { ok: false, status: 409, error: 'The task is no longer an idea', code: 'NOT_AN_IDEA' }
      }
      const owner = await prisma.project.findUnique({ where: { id: estimate.projectId }, select: { ownerId: true } })
      if (!owner) return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' }
      const moved = await updateTaskWithSideEffects({ taskId, actorId: owner.ownerId, actorType: 'user', intent: { statusRole: 'ready' } })
      if (!moved.ok) return { ok: false, status: 409, error: 'The task could not be moved to Ready', code: 'MOVE_FAILED' }
      await postSystemComment(taskId, `Moved to Ready: its estimate is labelled ${ref.label} (${approvedBy === POLICY_APPROVER ? 'the board policy allows it' : 'approved'}).\n\nGOAL-ACTION: promoteIdea ${estimateDigest(estimate)}`).catch(() => undefined)
      return { ok: true }
    },
  }
}

const EXPERIMENT_VERB = { experimentStart: 'start', experimentStop: 'stop' } as const
/** `start` acts on an experiment that has not begun; `stop` on one that is running. */
const EXPERIMENT_FROM = { experimentStart: ['pending'], experimentStop: ['running'] } as const

function experimentSubject(row: ExperimentRow, action: 'experimentStart' | 'experimentStop'): Subject | string {
  if (row.kind !== 'experiment' || !row.externalKey || !row.connectorId) return 'This is not a linked experiment'
  if (!isOpenExperiment(row) || !(EXPERIMENT_FROM[action] as readonly string[]).includes(row.state)) {
    return `The experiment is ${row.state}; it cannot ${EXPERIMENT_VERB[action]} now`
  }
  const key = row.externalKey
  const connectorId = row.connectorId
  const digest = experimentDigest(row, action)
  return {
    projectId: row.projectId,
    digest,
    estimate: null,
    summary: `${EXPERIMENT_VERB[action] === 'start' ? 'Start' : 'Stop'} experiment **${key}** (it is ${row.state}).`,
    run: async approvedBy => {
      const connector = await prisma.projectConnector.findFirst({ where: { id: connectorId, projectId: row.projectId } })
      const built = connector ? sourceTargetFor(connector, 'experiment') : null
      if (!built?.target) return { ok: false, status: 409, error: built?.error ?? 'The experiment connector was removed', code: 'NO_CONNECTOR' }
      const sent = await postExperimentAction(built.target, { key, action: EXPERIMENT_VERB[action], idempotencyKey: digest, approvedBy })
      if (!sent.ok) return { ok: false, status: 502, error: sent.error, code: 'ACTION_FAILED' }
      await postSystemComment(row.taskId, `Asked the experiment service to ${EXPERIMENT_VERB[action]} ${key}.\n\nGOAL-ACTION: ${action} ${digest}`).catch(() => undefined)
      return { ok: true }
    },
  }
}

// ── The policy ────────────────────────────────────────────────────────────────

/** What the board's policy lets the server do about this subject; `never` on anything it cannot answer. */
async function mayDo(taskId: string, subject: Subject, action: GoalAction): Promise<'allowed' | 'ask' | 'never'> {
  const stored = await storedPolicy(taskId, subject.projectId).catch(() => null)
  if (!stored) return 'never'
  const answer = orchestrationMay({ project: stored.project, list: stored.list }, SERVER_ACTOR, action as OrchestrationAction, null, subject.estimate)
  if (!answer.ok) {
    log.error({ taskId, action, message: answer.error.message }, 'Policy did not answer for a Goal signals action; not acting')
    return 'never'
  }
  return answer.value.decision
}

async function subjectFor(taskId: string, action: GoalAction, experimentId?: string): Promise<Subject | string> {
  if (action === 'promoteIdea') return promoteSubject(taskId)
  const row = experimentId
    ? await prisma.taskExperiment.findFirst({ where: { id: experimentId, taskId } })
    : null
  return row ? experimentSubject(row, action) : 'The experiment no longer exists'
}

const MARKER_LINE = (action: GoalAction, digest: string) => `${action} ${digest}`

/** Has this exact action (same digest) already been asked or done on the task? Then it is not asked again. */
async function alreadyHandled(taskId: string, action: GoalAction, digest: string): Promise<boolean> {
  const line = MARKER_LINE(action, digest)
  const found = await prisma.comment.findFirst({
    where: { taskId, OR: [{ systemEventType: GOAL_ACTION_COMMENT }, { systemEventType: 'APPROVAL_REQUEST' }], content: { contains: line } },
    select: { id: true },
  })
  return Boolean(found)
}

/**
 * The server's response to a label or a recommendation: act, ask, or leave it a recommendation, as the
 * board's policy says. Never throws.
 */
export async function actOnGoalSignal(taskId: string, action: GoalAction, options: { experimentId?: string } = {}): Promise<GoalActionOutcome> {
  try {
    const subject = await subjectFor(taskId, action, options.experimentId)
    if (typeof subject === 'string') return { status: 'recommendation', action, reason: subject }
    const decision = await mayDo(taskId, subject, action)
    if (decision === 'never') return { status: 'recommendation', action, reason: 'The board policy does not let the server do this' }
    if (await alreadyHandled(taskId, action, subject.digest)) return { status: 'recommendation', action, reason: 'Already asked or done for this snapshot' }
    if (decision === 'ask') {
      const owner = await prisma.project.findUnique({ where: { id: subject.projectId }, select: { ownerId: true } })
      if (!owner) return { status: 'recommendation', action, reason: 'The project no longer exists' }
      const card = await requestApproval({ taskId, authorId: owner.ownerId, request: { action, sha: subject.digest }, summary: subject.summary })
      return { status: 'asked', action, commentId: card.value.id }
    }
    const result = await subject.run(POLICY_APPROVER)
    return result.ok ? { status: 'acted', action } : { status: 'failed', action, reason: result.error }
  } catch (err) {
    log.error({ err, taskId, action }, 'Could not act on a Goal signals label')
    return { status: 'failed', action, reason: 'Unexpected error' }
  }
}

/**
 * Approve was tapped on a Goal signals card: run exactly what it names. Refused when the estimate or
 * snapshot has moved on (the digest differs, so the person approved something that is no longer true)
 * and when the policy now says `never`.
 */
export async function carryOutApprovedGoalAction(taskId: string, request: ApprovalRequest & { action: GoalAction }, approvedBy: string): Promise<CarryOutResult> {
  const stale: CarryOutResult = { ok: false, status: 409, error: 'The estimate or experiment has changed since this card; ask again', code: 'STALE_SNAPSHOT' }
  let subject: Subject | string
  if (request.action === 'promoteIdea') {
    subject = await promoteSubject(taskId)
  } else {
    const rows = await prisma.taskExperiment.findMany({ where: { taskId, kind: 'experiment' } })
    const match = rows.find(row => experimentDigest(row, request.action as 'experimentStart' | 'experimentStop') === request.sha)
    subject = match ? experimentSubject(match, request.action as 'experimentStart' | 'experimentStop') : 'gone'
    if (subject === 'gone') return stale
  }
  if (typeof subject === 'string') return { ok: false, status: 409, error: subject, code: 'NOTHING_TO_DO' }
  if (subject.digest !== request.sha) return stale
  if ((await mayDo(taskId, subject, request.action)) === 'never') {
    return { ok: false, status: 409, error: 'The board policy no longer allows this', code: 'POLICY_NEVER' }
  }
  return subject.run(approvedBy)
}
