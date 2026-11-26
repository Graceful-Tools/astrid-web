/**
 * A task's experiment links and verification windows, and the Pending results lane they feed
 * (ADEV-279, docs/specs/GOALS_GUARDRAILS_SIGNALS.md → The model → 5, 7).
 *
 * Two things happen to a link, and they are kept apart on purpose:
 *
 * 1. **It reports.** Every refresh (the settle job's, or a person's Refresh) reads the experiment
 *    source, or compares a verification's baseline with the project's sources, records the result on
 *    the row and, the moment a link concludes, says so once in a system comment on the task. This is
 *    true on EVERY board and for every task, in the column or not. Nothing here moves a task because
 *    of it.
 * 2. **The lane rules run.** Only for a task that is in the Pending results column (a board added it,
 *    ADEV-286) does astrid-core's `resultsSettle` get asked what to do: complete it, hand it back with
 *    a Decision, or leave it. A task outside the column is never completed, moved or handed back by
 *    rule (spec §7: "A board without the column loses the lane, not the results").
 *
 * Astrid computes no statistics: an experiment's numbers and verdict are its service's
 * (lib/experiment-source-client.ts). A verification's verdict is a before/after of numbers the
 * project already holds (lib/task-experiment.ts `compareVerification`).
 *
 * Who may link: anyone with write access to the task (the route checks). Who may NOT: an agent writes
 * an experiment's key like anyone else, but never a connector (services/project-connectors.service.ts).
 * Behind the goal-signals gate, which is the PROJECT OWNER's: the job reads it per project.
 */
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { canUseGoalSignals } from '@/lib/goal-signals'
import { RESULTS_STATUS_ROLE } from '@/lib/board-presets'
import { storedGoalsAndGuardrails, type GoalsAndGuardrails } from '@/lib/goals-guardrails'
import { effectiveOrchestrationPolicy } from '@/lib/core-rules/orchestration-core'
import { defaultOrchestrationPolicy, escalateTo, parsePolicyOverride, type OrchestrationPolicy } from '@/lib/orchestration-policy'
import { pollGoalMetrics } from '@/lib/goal-signals-poll'
import { fetchExperimentStatus } from '@/lib/experiment-source-client'
import { resultsSettle } from '@/lib/results-rules'
import {
  captureBaseline,
  compareVerification,
  decideByFromDays,
  EXPERIMENT_KEY_MAX_CHARS,
  EXPERIMENT_STALE_AFTER_HOURS,
  isOpenExperiment,
  storedBaseline,
  toResultCondition,
  type ExperimentKind,
  type ExperimentMetric,
  type ExperimentReading,
  type ExperimentRecommendation,
  type ExperimentState,
  type ExperimentVerdict,
} from '@/lib/task-experiment'
import { resultReportComment, resultsHandBackComment, resultsPassedComment } from '@/lib/task-experiment-copy'
import { connectorFailureText, recordConnectorOutcome, sourceTargetFor } from '@/services/project-connectors.service'
import { recordGoalMeasurement } from '@/services/project-goals.service'
import { completeTask } from '@/services/complete-task'
import { updateTaskWithSideEffects } from '@/services/task.service'
import { actOnGoalSignal } from '@/services/goal-action.service'

const log = createLogger('task-experiment')

export type ExperimentResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 404 | 409 | 422; error: string; reason?: string }

/** Links per task: enough for a few experiments and a verification, not a dumping ground. */
export const EXPERIMENTS_PER_TASK_MAX = 10
/** How many links one settle pass will refresh: the cron has a 60 s budget and each call can take 10. */
export const MAX_LINKS_PER_PASS = 20
const URL_MAX_CHARS = 500
const SOURCE_BY = 'results-settle'

type Row = Awaited<ReturnType<typeof prisma.taskExperiment.findFirstOrThrow>>

export interface ExperimentView {
  id: string
  taskId: string
  projectId: string
  kind: ExperimentKind
  connectorId: string | null
  externalKey: string | null
  url: string | null
  state: ExperimentState
  verdict: ExperimentVerdict | null
  recommendation: ExperimentRecommendation | null
  /** The service's per-metric numbers, as it gave them. Empty for a verification. */
  metrics: ExperimentMetric[]
  /** A verification's per-goal lines. Empty for an experiment. */
  findings: unknown[]
  startedAt: string | null
  decideBy: string | null
  /** When Astrid last got an answer. Past `staleAfterHours` the client says "no data since …". */
  fetchedAt: string | null
  stale: boolean
  lastError: string | null
}

export function isStale(fetchedAt: Date | null, now: Date): boolean {
  return fetchedAt === null || now.getTime() - fetchedAt.getTime() > EXPERIMENT_STALE_AFTER_HOURS * 3_600_000
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The metrics of a stored snapshot; it was written by `sanitizeExperimentReply`, so its shape is ours. */
const metricsOf = (snapshot: Record<string, unknown>): ExperimentMetric[] =>
  Array.isArray(snapshot.metrics) ? (snapshot.metrics as unknown as ExperimentMetric[]) : []

export function experimentView(row: Row, now: Date = new Date()): ExperimentView {
  const snapshot = isRecord(row.snapshot) ? row.snapshot : {}
  return {
    id: row.id,
    taskId: row.taskId,
    projectId: row.projectId,
    kind: row.kind === 'verification' ? 'verification' : 'experiment',
    connectorId: row.connectorId,
    externalKey: row.externalKey,
    url: row.url,
    state: row.state as ExperimentState,
    verdict: (row.verdict as ExperimentVerdict | null) ?? null,
    recommendation: (row.recommendation as ExperimentRecommendation | null) ?? null,
    metrics: metricsOf(snapshot),
    findings: Array.isArray(snapshot.findings) ? snapshot.findings : [],
    startedAt: row.startedAt?.toISOString() ?? null,
    decideBy: row.decideBy?.toISOString() ?? null,
    fetchedAt: row.fetchedAt?.toISOString() ?? null,
    stale: isStale(row.fetchedAt, now),
    lastError: row.lastError,
  }
}

// ── The task and its project ──────────────────────────────────────────────────

async function loadTask(taskId: string) {
  return prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      creatorId: true,
      statusRole: true,
      completed: true,
      lists: {
        select: {
          id: true,
          ownerId: true,
          orchestrationPolicy: true,
          project: { select: { id: true, ownerId: true, goalsAndGuardrails: true, orchestrationPolicy: true } },
        },
      },
    },
  })
}

type LoadedTask = NonNullable<Awaited<ReturnType<typeof loadTask>>>

/** The project this link is about: the named one, else the task's only one. */
function chooseProject(task: LoadedTask, projectId?: string): ExperimentResult<{ id: string; ownerId: string; goals: unknown }> {
  const projects = new Map<string, { id: string; ownerId: string; goals: unknown }>()
  for (const list of task.lists) {
    if (list.project) projects.set(list.project.id, { id: list.project.id, ownerId: list.project.ownerId, goals: list.project.goalsAndGuardrails })
  }
  if (projectId) {
    const found = projects.get(projectId)
    return found ? { ok: true, value: found } : { ok: false, status: 404, error: 'Project not found on this task' }
  }
  if (projects.size === 1) return { ok: true, value: [...projects.values()][0] }
  if (!projects.size) return { ok: false, status: 400, error: "The task's lists are in no project" }
  return { ok: false, status: 400, error: 'The task is in several projects; send { projectId }' }
}

const overrideOf = (value: unknown) => {
  const parsed = parsePolicyOverride(value)
  return parsed.ok ? parsed.value : null
}

/** Who a task goes back to when its results did not pass: the policy's escalation target. */
export function escalationTargetFor(task: LoadedTask, projectId: string): string | null {
  const list = task.lists.find(l => l.project?.id === projectId) ?? task.lists[0]
  if (!list) return null
  const answer = effectiveOrchestrationPolicy({ project: overrideOf(list.project?.orchestrationPolicy), list: overrideOf(list.orchestrationPolicy) })
  const policy: OrchestrationPolicy = answer.ok ? answer.value : defaultOrchestrationPolicy()
  return escalateTo(policy, list.ownerId ?? list.project?.ownerId ?? task.creatorId ?? '', task.creatorId).notify[0] ?? null
}

// ── Reading and linking ───────────────────────────────────────────────────────

export interface TaskExperimentsView {
  experiments: ExperimentView[]
  /** The task is in the Pending results column, so the lane rules govern it. */
  inResultsColumn: boolean
}

export async function getTaskExperiments(taskId: string): Promise<ExperimentResult<TaskExperimentsView>> {
  const task = await loadTask(taskId)
  if (!task) return { ok: false, status: 404, error: 'Task not found' }
  const rows = await prisma.taskExperiment.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } })
  const now = new Date()
  return {
    ok: true,
    value: {
      experiments: rows.map(row => experimentView(row, now)),
      inResultsColumn: !task.completed && task.statusRole === RESULTS_STATUS_ROLE,
    },
  }
}

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t.slice(0, max) : undefined
}

function parseDecideBy(value: unknown): Date | null | 'invalid' {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return 'invalid'
  const t = Date.parse(value)
  return Number.isNaN(t) ? 'invalid' : new Date(t)
}

/**
 * Link a task to an experiment, or start a verification window.
 *
 *   { kind: "experiment", connectorId, externalKey, url?, decideBy? }
 *   { kind: "verification", days } | { kind: "verification", decideBy }
 *
 * A verification records the project's goal and guardrail values now: the deploy. Always `201`.
 */
export async function linkTaskExperiment(
  taskId: string,
  body: unknown,
  now: Date = new Date(),
): Promise<ExperimentResult<ExperimentView>> {
  const task = await loadTask(taskId)
  if (!task) return { ok: false, status: 404, error: 'Task not found' }
  const input = (isRecord(body) ? body : {}) as Record<string, unknown>
  const chosen = chooseProject(task, text(input.projectId, 120))
  if (!chosen.ok) return chosen
  const project = chosen.value
  if (!(await canUseGoalSignals(project.ownerId))) return { ok: false, status: 404, error: 'Goal signals are not enabled for this project' }
  if (input.kind !== 'experiment' && input.kind !== 'verification') {
    return { ok: false, status: 400, error: 'kind is "experiment" or "verification"' }
  }
  if ((await prisma.taskExperiment.count({ where: { taskId } })) >= EXPERIMENTS_PER_TASK_MAX) {
    return { ok: false, status: 400, error: `At most ${EXPERIMENTS_PER_TASK_MAX} experiments or verifications per task` }
  }

  const decideBy = parseDecideBy(input.decideBy)
  if (decideBy === 'invalid') return { ok: false, status: 400, error: 'decideBy is an ISO date' }

  if (input.kind === 'experiment') {
    const connectorId = text(input.connectorId, 120)
    const externalKey = text(input.externalKey, EXPERIMENT_KEY_MAX_CHARS)
    if (!connectorId || !externalKey) return { ok: false, status: 400, error: 'An experiment needs a connectorId and an externalKey' }
    const connector = await prisma.projectConnector.findFirst({ where: { id: connectorId, projectId: project.id, kind: 'experiment' }, select: { id: true } })
    if (!connector) return { ok: false, status: 404, error: 'Experiment connector not found in this project' }
    const url = text(input.url, URL_MAX_CHARS)
    if (url && !/^https:\/\//i.test(url)) return { ok: false, status: 400, error: 'url is an https link' }
    const row = await prisma.taskExperiment.create({
      data: { taskId, projectId: project.id, kind: 'experiment', connectorId, externalKey, url: url ?? null, decideBy },
    })
    return { ok: true, value: experimentView(row, now) }
  }

  // A verification: a window of `days` from the deploy, or an explicit end.
  const days = typeof input.days === 'number' ? input.days : undefined
  const end = decideBy ?? (days !== undefined ? decideByFromDays(days, now) : null)
  if (!end) return { ok: false, status: 400, error: 'A verification needs days (1 to 90) or a future decideBy' }
  if (end.getTime() <= now.getTime()) return { ok: false, status: 400, error: 'decideBy is already past' }
  const baseline = captureBaseline(storedGoalsAndGuardrails(project.goals), now)
  const row = await prisma.taskExperiment.create({
    data: {
      taskId,
      projectId: project.id,
      kind: 'verification',
      state: 'running',
      startedAt: now,
      decideBy: end,
      baseline: baseline as unknown as Prisma.InputJsonValue,
      fetchedAt: now,
    },
  })
  return { ok: true, value: experimentView(row, now) }
}

export async function unlinkTaskExperiment(taskId: string, experimentId: string): Promise<ExperimentResult<{ deleted: true }>> {
  const { count } = await prisma.taskExperiment.deleteMany({ where: { id: experimentId, taskId } })
  if (!count) return { ok: false, status: 404, error: 'Experiment link not found' }
  return { ok: true, value: { deleted: true } }
}

// ── Refreshing one link ───────────────────────────────────────────────────────

const digestOf = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export interface RefreshOptions {
  now?: Date
  fetchImpl?: typeof fetch
}

export interface RefreshOutcome {
  /** The link's row after the refresh. */
  row: Row
  /** It went from open to concluded in this refresh, and the report was written. */
  concluded: boolean
  /** The source could not be read (the row says why). */
  failed: boolean
}

/** The state an experiment source reports, or `unknown`; never trusted past the enum. */
const SERVICE_STATES = new Set<string>(['pending', 'running', 'concluded', 'stopped', 'unknown'])

async function postSystemComment(taskId: string, content: string, systemEventType: string) {
  await prisma.comment.create({ data: { taskId, authorId: null, content, type: 'MARKDOWN', systemEventType } })
}

/** The lines a report names a verification's findings with. */
function findingLines(findings: unknown): string[] {
  return (Array.isArray(findings) ? findings : []).flatMap(f => (isRecord(f) && typeof f.text === 'string' ? [`- ${f.text}`] : []))
}

function metricLines(metrics: ExperimentMetric[]): string[] {
  return metrics.map(m => {
    const parts: string[] = []
    if (m.control !== undefined && m.treatment !== undefined) parts.push(`${m.control} → ${m.treatment}`)
    if (m.relDelta !== undefined) parts.push(`${m.relDelta >= 0 ? '+' : ''}${(m.relDelta * 100).toFixed(1)}%`)
    if (m.significant !== undefined) parts.push(m.significant ? 'significant' : 'not significant')
    return `- ${m.metricKey}${parts.length ? `: ${parts.join(', ')}` : ''}`
  })
}

/** The report of a concluded link, from its row. */
function reportOf(row: Row): string {
  const snapshot = isRecord(row.snapshot) ? row.snapshot : {}
  const metrics = metricsOf(snapshot)
  return resultReportComment({
    kind: row.kind === 'verification' ? 'verification' : 'experiment',
    verdict: (row.verdict as ExperimentVerdict | null) ?? null,
    url: row.url,
    recommendation: (row.recommendation as ExperimentRecommendation | null) ?? null,
    lines: findingLines(snapshot.findings),
    metricLines: metricLines(metrics),
  })
}

async function refreshExperimentKind(row: Row, project: { id: string; ownerId: string; goalsAndGuardrails: unknown }, now: Date, fetchImpl?: typeof fetch) {
  const connector = row.connectorId ? await prisma.projectConnector.findFirst({ where: { id: row.connectorId, projectId: row.projectId } }) : null
  if (!connector || !row.externalKey) {
    return prisma.taskExperiment.update({ where: { id: row.id }, data: { lastError: 'The experiment connector was removed' } })
  }
  const built = sourceTargetFor(connector, 'experiment')
  const result = built.target
    ? await fetchExperimentStatus(built.target, row.externalKey, storedGoalsAndGuardrails(project.goalsAndGuardrails), { fetchImpl, now: () => now })
    : ({ ok: false, kind: 'client', error: built.error } as const)
  await recordConnectorOutcome(connector.id, result.ok ? { ok: true } : result, now).catch(() => undefined)
  if (!result.ok) {
    // A failure is recorded and nothing else changes: the last good result stays, and `fetchedAt`
    // keeps aging, which is how the card comes to say "no data since …" (P4).
    return prisma.taskExperiment.update({ where: { id: row.id }, data: { lastError: connectorFailureText(result.error) } })
  }
  const reading: ExperimentReading = result.reading
  const state = SERVICE_STATES.has(reading.state) ? reading.state : 'unknown'
  const snapshot = { metrics: reading.metrics, at: reading.at }
  return prisma.taskExperiment.update({
    where: { id: row.id },
    data: {
      state,
      verdict: reading.verdict,
      recommendation: reading.recommendation ? (reading.recommendation as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      snapshotDigest: digestOf(snapshot),
      ...(reading.url ? { url: reading.url } : {}),
      ...(reading.startedAt ? { startedAt: new Date(reading.startedAt) } : {}),
      fetchedAt: now,
      lastError: null,
    },
  })
}

async function refreshVerificationKind(row: Row, project: { id: string; ownerId: string; goalsAndGuardrails: unknown }, now: Date, fetchImpl?: typeof fetch) {
  const ended = row.decideBy !== null && row.decideBy.getTime() <= now.getTime()
  let goals = project.goalsAndGuardrails
  if (ended) {
    // The window is over: read the project's sources fresh, then compare what they now hold.
    await pollGoalMetrics({ projectId: project.id, fetchImpl, now: () => now }).catch(error => {
      log.warn({ err: error, projectId: project.id }, 'Metric poll before a verification failed; comparing what is stored')
    })
    const fresh = await prisma.project.findUnique({ where: { id: project.id }, select: { goalsAndGuardrails: true } })
    goals = fresh?.goalsAndGuardrails ?? goals
  }
  const stated: GoalsAndGuardrails = storedGoalsAndGuardrails(goals)
  const result = compareVerification(storedBaseline(row.baseline), stated, now)
  const snapshot = { findings: result.findings, at: now.toISOString() }
  return prisma.taskExperiment.update({
    where: { id: row.id },
    data: {
      state: ended ? 'concluded' : 'running',
      // Only a window that has ended has a verdict: before that it is progress, not a result.
      verdict: ended ? result.verdict : null,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      snapshotDigest: digestOf(snapshot),
      fetchedAt: now,
      lastError: null,
    },
  })
}

/**
 * Refresh one link: read its source (or compare its verification), record the result and, when it
 * has just concluded, say so on the task. Never throws for a source that cannot be read.
 */
export async function refreshExperimentRow(row: Row, options: RefreshOptions = {}): Promise<RefreshOutcome> {
  const now = options.now ?? new Date()
  if (!isOpenExperiment(row)) return { row, concluded: false, failed: false }
  const project = await prisma.project.findUnique({ where: { id: row.projectId }, select: { id: true, ownerId: true, goalsAndGuardrails: true } })
  // A project that lost the feature costs no request.
  if (!project || !(await canUseGoalSignals(project.ownerId))) return { row, concluded: false, failed: false }

  const updated = row.kind === 'verification'
    ? await refreshVerificationKind(row, project, now, options.fetchImpl)
    : await refreshExperimentKind(row, project, now, options.fetchImpl)
  const concluded = !isOpenExperiment(updated)
  // A service that recommends starting or stopping may be obeyed, as the board's policy says (ADEV-284).
  const recommended = (updated.recommendation as ExperimentRecommendation | null)?.action
  if (!concluded && (recommended === 'start' || recommended === 'stop')) {
    await actOnGoalSignal(updated.taskId, recommended === 'start' ? 'experimentStart' : 'experimentStop', { experimentId: updated.id })
  }
  if (concluded) {
    // Once: only the refresh that took it from open to concluded reports.
    await postSystemComment(updated.taskId, reportOf(updated), 'EXPERIMENT_RESULT').catch(error => {
      log.error({ err: error, taskId: updated.taskId }, 'Could not write the result report')
    })
  }
  return { row: updated, concluded, failed: updated.lastError !== null }
}

// ── The lane ──────────────────────────────────────────────────────────────────

export type LaneOutcome = 'not-in-column' | 'stay' | 'completed' | 'handed-back' | 'skipped'

/** The goals a passed result moved, for the measurement that names the task. */
function servedGoalIds(rows: Row[]): string[] {
  const ids = new Set<string>()
  for (const row of rows) {
    const snapshot = isRecord(row.snapshot) ? row.snapshot : {}
    for (const m of metricsOf(snapshot)) if (m.goalId) ids.add(m.goalId)
    for (const f of Array.isArray(snapshot.findings) ? snapshot.findings : []) {
      if (isRecord(f) && f.kind === 'goal' && typeof f.id === 'string' && (f.outcome === 'improved' || f.outcome === 'held')) ids.add(f.id)
    }
    const baseline = storedBaseline(row.baseline)
    for (const g of baseline?.goals ?? []) ids.add(g.id)
  }
  return [...ids]
}

/** P2's goal measurement: the goal's current fresh reading, recorded against the task that earned it. */
async function recordPassedMeasurements(task: LoadedTask, projectId: string, ownerId: string, rows: Row[]) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { goalsAndGuardrails: true } })
  const stated = storedGoalsAndGuardrails(project?.goalsAndGuardrails)
  for (const goalId of servedGoalIds(rows)) {
    const metric = stated.goals.find(g => g.id === goalId)?.metric
    if (!metric || typeof metric.current !== 'number' || !metric.measuredAt) continue
    await recordGoalMeasurement(
      projectId,
      ownerId,
      goalId,
      { value: metric.current, ...(metric.unit ? { unit: metric.unit } : {}), at: metric.measuredAt, taskId: task.id, externalId: `results:${task.id}:${goalId}` },
      SOURCE_BY,
      'pull',
    ).catch(error => log.warn({ err: error, taskId: task.id, goalId }, 'Could not record the passed result against its goal'))
  }
}

/**
 * Put one task where its results say it belongs, **only if it is in the Pending results column**.
 * Outside the column this changes nothing (the report was already written by the refresh).
 */
export async function settleResultsTask(taskId: string, now: Date = new Date()): Promise<LaneOutcome> {
  const task = await loadTask(taskId)
  if (!task || task.completed || task.statusRole !== RESULTS_STATUS_ROLE) return 'not-in-column'
  const rows = await prisma.taskExperiment.findMany({ where: { taskId } })
  const project = chooseProject(task)
  const projectId = rows[0]?.projectId ?? (project.ok ? project.value.id : null)
  const ownerId = task.lists.find(l => l.project?.id === projectId)?.project?.ownerId ?? task.lists[0]?.ownerId
  const target = projectId ? escalationTargetFor(task, projectId) : null
  if (!projectId || !ownerId || !target) return 'skipped'

  const settlement = resultsSettle({ id: task.id, statusRole: task.statusRole, assigneeId: null, completed: false }, rows.map(toResultCondition), target, now)
  const report = rows.filter(row => !isOpenExperiment(row)).map(reportOf).join('\n\n')

  if (settlement.action === 'complete') {
    const done = await completeTask({ taskId, actorId: ownerId, actorType: 'user', completedSource: 'results' })
    if (!done.ok) {
      log.warn({ taskId, status: done.status }, 'Could not complete a task whose results passed')
      return 'skipped'
    }
    await postSystemComment(taskId, resultsPassedComment(report), 'RESULTS_PASSED').catch(() => undefined)
    await recordPassedMeasurements(task, projectId, ownerId, rows)
    return 'completed'
  }

  if (settlement.action === 'handBack' && settlement.assigneeId && settlement.reason) {
    // Out of the column, to the escalation target. Nothing rolls back.
    const moved = await updateTaskWithSideEffects({
      taskId,
      actorId: ownerId,
      actorType: 'user',
      intent: { statusRole: null, assigneeId: settlement.assigneeId, assigneeIds: [settlement.assigneeId] },
    })
    if (!moved.ok) {
      log.warn({ taskId, status: moved.status }, 'Could not hand back a task whose results did not pass')
      return 'skipped'
    }
    await postSystemComment(taskId, resultsHandBackComment(settlement.reason, report), 'RESULTS_HANDED_BACK').catch(() => undefined)
    return 'handed-back'
  }
  return 'stay'
}

/** A person's Refresh: every open link on the task, then the lane rules at once (a task outside the column only reports). */
export async function refreshTaskExperiments(taskId: string, options: RefreshOptions = {}): Promise<ExperimentResult<TaskExperimentsView & { lane: LaneOutcome }>> {
  const task = await loadTask(taskId)
  if (!task) return { ok: false, status: 404, error: 'Task not found' }
  const rows = await prisma.taskExperiment.findMany({ where: { taskId, state: { notIn: ['concluded', 'stopped'] } }, orderBy: { createdAt: 'asc' } })
  for (const row of rows) await refreshExperimentRow(row, options)
  const lane = await settleResultsTask(taskId, options.now)
  const view = await getTaskExperiments(taskId)
  return view.ok ? { ok: true, value: { ...view.value, lane } } : view
}

// ── The scheduled pass ────────────────────────────────────────────────────────

export interface SettlePassSummary {
  links: number
  capped: boolean
  refreshed: number
  concluded: number
  failed: number
  tasksSettled: number
  completed: number
  handedBack: number
}

/**
 * One pass of `/api/cron/results-settle`: a BOUNDED, stalest-first walk over open links (the
 * lib/sync/github/sync-all-links.ts template), so a pass cut short leaves the rest at the front of the
 * next one. One link's failure never stops the rest. Every refreshed link reports; the lane rules then
 * run for each affected task that is in the column, and for no other.
 */
export async function runResultsSettlePass(options: RefreshOptions & { limit?: number } = {}): Promise<SettlePassSummary> {
  const now = options.now ?? new Date()
  const limit = options.limit ?? MAX_LINKS_PER_PASS
  const open = { state: { notIn: ['concluded', 'stopped'] } }
  const rows = await prisma.taskExperiment.findMany({
    where: open,
    orderBy: { fetchedAt: { sort: 'asc', nulls: 'first' } },
    take: limit,
  })
  const total = await prisma.taskExperiment.count({ where: open })
  const summary: SettlePassSummary = { links: rows.length, capped: total > rows.length, refreshed: 0, concluded: 0, failed: 0, tasksSettled: 0, completed: 0, handedBack: 0 }

  const touched = new Set<string>()
  for (const row of rows) {
    try {
      const outcome = await refreshExperimentRow(row, { now, fetchImpl: options.fetchImpl })
      summary.refreshed++
      if (outcome.concluded) summary.concluded++
      if (outcome.failed) summary.failed++
      touched.add(row.taskId)
    } catch (error) {
      summary.failed++
      log.error({ err: error, experimentId: row.id }, 'Refreshing an experiment link failed')
    }
  }
  // A task in the column with a deadline that has passed is settled even if nothing refreshed it
  // (a silent source, P4), so those join the walk.
  const overdue = await prisma.task.findMany({
    where: { completed: false, statusRole: RESULTS_STATUS_ROLE, experiments: { some: {} } },
    select: { id: true },
    take: limit,
  })
  for (const task of overdue) touched.add(task.id)

  for (const taskId of touched) {
    try {
      const lane = await settleResultsTask(taskId, now)
      if (lane === 'completed') summary.completed++
      if (lane === 'handed-back') summary.handedBack++
      if (lane !== 'not-in-column') summary.tasksSettled++
    } catch (error) {
      summary.failed++
      log.error({ err: error, taskId }, 'Settling a task in Pending results failed')
    }
  }
  return summary
}
