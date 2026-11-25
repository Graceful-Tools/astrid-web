/**
 * Task estimates (ADEV-278, docs/specs/GOALS_GUARDRAILS_SIGNALS.md → Estimates).
 *
 * `TaskEstimate` is append-only: the latest row for a task is its current estimate. A row is written
 * by the server from an estimator's reply (the built-in model or a registered service), or by a person
 * as `source: "human"`. An agent never writes one; it may ask for one (the route refuses `human`
 * from an agent). Every reply is untrusted data and goes through `sanitizeEstimate` first.
 *
 * Cost also lands on `Task.costEstimateMicrocents` with source `model`, only when no human value is
 * there, so task cost keeps one home (TASK_COST_INTELLIGENCE.md).
 */
import { createHash, randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { enqueueJob } from '@/lib/jobs/queue'
import type { EstimatorPollPayload } from '@/lib/jobs/kinds'
import { storedGoalsAndGuardrails, goalMeasurePhrase } from '@/lib/goals-guardrails'
import {
  ESTIMATOR_CONTRACT,
  isEmptyEstimate,
  markBuiltinEstimate,
  sanitizeEstimate,
  type EstimateBody,
  type EstimateScope,
} from '@/lib/task-estimate'
import {
  BUILTIN_ESTIMATOR,
  builtinEstimatorEnabled,
  signalServicesOfKind,
  type SignalService,
} from '@/lib/goal-signal-services'
import { EstimatorError, pollEstimate, requestEstimate, type EstimatorReply, type EstimatorRequest } from '@/lib/estimator-client'
import { runBuiltinEstimator } from '@/lib/ai/builtin-estimator'

const log = createLogger('task-estimate')

export type EstimateResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 404 | 409 | 422 | 502; error: string; reason?: string }

export interface EstimateView extends EstimateBody {
  id: string
  taskId: string
  projectId: string
  source: string
  contractVersion: string
  requestedById: string
  createdAt: string
  /** True for the built-in model: the card shows ranges under a "rough estimate" tag. */
  rough: boolean
  label: string | null
}

export type RequestOutcome =
  | { state: 'ready'; estimate: EstimateView }
  | { state: 'pending'; service: string }

/** A stored cost lands on Task.costEstimateMicrocents, an Int column. */
const TASK_COST_COLUMN_MAX = 2_147_483_647
const POLL_GIVE_UP_MS = 60 * 60_000
const HISTORY_LIMIT = 20

type Row = Awaited<ReturnType<typeof prisma.taskEstimate.findFirstOrThrow>>

export function estimateView(row: Row): EstimateView {
  return {
    id: row.id,
    taskId: row.taskId,
    projectId: row.projectId,
    source: row.source,
    contractVersion: row.contractVersion,
    requestedById: row.requestedById,
    createdAt: row.createdAt.toISOString(),
    goalImpacts: row.goalImpacts as unknown as EstimateBody['goalImpacts'],
    guardrailImpacts: row.guardrailImpacts as unknown as EstimateBody['guardrailImpacts'],
    risk: row.risk as unknown as EstimateBody['risk'],
    costMicrocents: row.costMicrocents === null ? null : Number(row.costMicrocents),
    effortHours: row.effortHours,
    reach: (row.reach ?? null) as unknown as EstimateBody['reach'],
    confidence: row.confidence as EstimateBody['confidence'],
    rationale: row.rationale,
    rough: row.source === 'builtin_llm',
    label: row.label,
  }
}

async function loadTask(taskId: string) {
  return prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      description: true,
      costEstimateSource: true,
      lists: {
        select: {
          id: true,
          projectId: true,
          preferredAiProvider: true,
          project: { select: { id: true, name: true, goalsAndGuardrails: true } },
        },
      },
    },
  })
}

type LoadedTask = NonNullable<Awaited<ReturnType<typeof loadTask>>>

interface Context {
  task: LoadedTask
  projectId: string
  listProvider: string | null
  scope: EstimateScope
  request: EstimatorRequest
  inputsDigest: string
}

/** The project this estimate is about: the named one, else the task's only one. */
function chooseProject(task: LoadedTask, projectId?: string): EstimateResult<{ id: string; goals: unknown; listProvider: string | null }> {
  const projects = new Map<string, { id: string; goals: unknown; listProvider: string | null }>()
  for (const list of task.lists) {
    if (!list.project) continue
    const existing = projects.get(list.project.id)
    projects.set(list.project.id, {
      id: list.project.id,
      goals: list.project.goalsAndGuardrails,
      listProvider: existing?.listProvider ?? list.preferredAiProvider ?? null,
    })
  }
  if (projectId) {
    const found = projects.get(projectId)
    return found ? { ok: true, value: found } : { ok: false, status: 404, error: 'Project not found on this task' }
  }
  if (projects.size === 1) return { ok: true, value: [...projects.values()][0] }
  if (!projects.size) return { ok: false, status: 400, error: "The task's lists are in no project" }
  return { ok: false, status: 400, error: 'The task is in several projects; send { projectId }' }
}

function buildContext(task: LoadedTask, projectId?: string): EstimateResult<Context> {
  const chosen = chooseProject(task, projectId)
  if (!chosen.ok) return chosen
  const stated = storedGoalsAndGuardrails(chosen.value.goals as never)
  if (!stated.goals.length && !stated.guardrails.length) {
    return { ok: false, status: 400, error: 'The project states no goals or guardrails to estimate against' }
  }
  const request: EstimatorRequest = {
    requestId: randomUUID(),
    idea: { id: task.id, title: task.title, description: task.description ?? '' },
    goals: stated.goals.map(goal => ({
      id: goal.id,
      statement: goal.statement,
      ...(goal.measure ? { metricKey: goal.measure } : {}),
      ...(goal.metric?.unit ? { unit: goal.metric.unit } : {}),
      ...(goal.metric?.direction ? { direction: goal.metric.direction } : {}),
      ...(goal.metric?.target !== undefined ? { target: goal.metric.target } : {}),
      ...(goal.metric?.current !== undefined ? { current: goal.metric.current } : {}),
      ...(!goal.metric && goalMeasurePhrase(goal) ? { measure: goalMeasurePhrase(goal) } : {}),
    })),
    guardrails: stated.guardrails.map(rail => ({ id: rail.id, statement: rail.statement })),
    want: ['goalImpacts', 'guardrailImpacts', 'risk', 'cost', 'reach'],
  }
  // The digest names the inputs, not the request: requestId is fresh each time.
  const { requestId: _requestId, ...inputs } = request
  void _requestId
  return {
    ok: true,
    value: {
      task,
      projectId: chosen.value.id,
      listProvider: chosen.value.listProvider,
      scope: {
        goalIds: new Set(stated.goals.map(g => g.id)),
        guardrailIds: new Set(stated.guardrails.map(g => g.id)),
      },
      request,
      inputsDigest: createHash('sha256').update(JSON.stringify(inputs)).digest('hex'),
    },
  }
}

/** Append the row, and write the model cost to the task when no human value is there. */
async function persist(
  ctx: Pick<Context, 'projectId' | 'inputsDigest'> & { taskId: string; costSource: string | null },
  source: string,
  contractVersion: string,
  requestedById: string,
  body: EstimateBody,
): Promise<EstimateView> {
  const row = await prisma.taskEstimate.create({
    data: {
      taskId: ctx.taskId,
      projectId: ctx.projectId,
      source,
      contractVersion,
      requestedById,
      inputsDigest: ctx.inputsDigest,
      goalImpacts: body.goalImpacts as never,
      guardrailImpacts: body.guardrailImpacts as never,
      risk: body.risk as never,
      costMicrocents: body.costMicrocents === null ? null : BigInt(body.costMicrocents),
      effortHours: body.effortHours,
      reach: (body.reach ?? undefined) as never,
      confidence: body.confidence,
      rationale: body.rationale,
    },
  })
  if (body.costMicrocents !== null) {
    const human = source === 'human'
    if (human || ctx.costSource !== 'human') {
      await prisma.task.update({
        where: { id: ctx.taskId },
        data: {
          costEstimateMicrocents: Math.min(body.costMicrocents, TASK_COST_COLUMN_MAX),
          costEstimateSource: human ? 'human' : 'model',
        },
      })
    }
  }
  return estimateView(row)
}

/** The estimator to use: the named one, else the first service the environment defines, else the built-in. */
function chooseEstimator(
  requested: string | undefined,
): EstimateResult<{ kind: 'builtin' } | { kind: 'service'; service: SignalService }> {
  const services = signalServicesOfKind('estimator')
  const builtinOn = builtinEstimatorEnabled(process.env.ASTRID_SIGNALS_BUILTIN_ESTIMATOR)
  const key = requested ?? services[0]?.key ?? (builtinOn ? BUILTIN_ESTIMATOR : undefined)
  if (key === BUILTIN_ESTIMATOR) {
    return builtinOn
      ? { ok: true, value: { kind: 'builtin' } }
      : { ok: false, status: 400, error: 'The built-in estimator is turned off on this deployment' }
  }
  const service = services.find(s => s.key === key)
  return service
    ? { ok: true, value: { kind: 'service', service } }
    : { ok: false, status: 400, error: 'No such estimator on this deployment' }
}

function failure(error: unknown): EstimateResult<never> {
  const message = error instanceof Error ? error.message : 'The estimator failed'
  return { ok: false, status: 502, error: message, reason: 'estimator_failed' }
}

async function finishWithResult(
  ctx: Pick<Context, 'projectId' | 'inputsDigest' | 'scope'> & { taskId: string; costSource: string | null },
  source: string,
  requestedById: string,
  raw: unknown,
  builtin: boolean,
): Promise<EstimateResult<EstimateView>> {
  let body = sanitizeEstimate(raw, ctx.scope)
  if (builtin) body = markBuiltinEstimate(body)
  if (isEmptyEstimate(body)) {
    return { ok: false, status: 422, error: 'The estimator returned nothing usable for this project', reason: 'empty_estimate' }
  }
  return { ok: true, value: await persist(ctx, source, ESTIMATOR_CONTRACT, requestedById, body) }
}

/** Ask an estimator for this task. The server writes the row; the caller never supplies numbers. */
export async function requestTaskEstimate(
  taskId: string,
  requestedById: string,
  input: { estimator?: string; projectId?: string } = {},
): Promise<EstimateResult<RequestOutcome>> {
  const task = await loadTask(taskId)
  if (!task) return { ok: false, status: 404, error: 'Task not found' }
  const built = buildContext(task, input.projectId)
  if (!built.ok) return built
  const ctx = built.value
  const chosen = chooseEstimator(input.estimator)
  if (!chosen.ok) return chosen
  const base = { projectId: ctx.projectId, inputsDigest: ctx.inputsDigest, scope: ctx.scope, taskId, costSource: task.costEstimateSource }

  if (chosen.value.kind === 'builtin') {
    const result = await runBuiltinEstimator(requestedById, ctx.listProvider, ctx.request)
    if (!result.ok) {
      return { ok: false, status: result.reason === 'no_api_key' ? 409 : 502, error: result.message, reason: result.reason }
    }
    const done = await finishWithResult(base, 'builtin_llm', requestedById, result.result, true)
    return done.ok ? { ok: true, value: { state: 'ready', estimate: done.value } } : done
  }

  const { service } = chosen.value
  let reply: EstimatorReply
  try {
    reply = await requestEstimate(service, ctx.request)
  } catch (error) {
    log.warn({ err: error, service: service.key, taskId }, 'Estimator request failed')
    return failure(error)
  }
  if (reply.kind === 'pending') {
    await enqueueJob(
      'estimator-poll',
      {
        taskId,
        projectId: ctx.projectId,
        serviceKey: service.key,
        estimateId: reply.estimateId,
        requestedById,
        inputsDigest: ctx.inputsDigest,
        startedAt: new Date().toISOString(),
      },
      { dedupeKey: `estimator-poll:${service.key}:${reply.estimateId}`, runAfter: new Date(Date.now() + reply.pollAfterSeconds * 1000) },
    )
    return { ok: true, value: { state: 'pending', service: service.key } }
  }
  const done = await finishWithResult(base, `service:${service.key}`, requestedById, reply.result, false)
  return done.ok ? { ok: true, value: { state: 'ready', estimate: done.value } } : done
}

/** One poll of a slow service. "Still running" throws, so the queue backs off and tries again. */
export async function runEstimatorPollJob(payload: EstimatorPollPayload): Promise<void> {
  if (Date.now() - new Date(payload.startedAt).getTime() > POLL_GIVE_UP_MS) {
    log.warn({ ...payload }, 'Estimator never finished; giving up')
    return
  }
  const service = signalServicesOfKind('estimator').find(s => s.key === payload.serviceKey)
  if (!service) {
    log.warn({ serviceKey: payload.serviceKey }, 'Estimator is no longer registered; dropping the poll')
    return
  }
  let reply: EstimatorReply
  try {
    reply = await pollEstimate(service, payload.estimateId)
  } catch (error) {
    if (error instanceof EstimatorError && !error.retryable) {
      log.warn({ err: error, serviceKey: service.key, taskId: payload.taskId }, 'Estimator poll failed for good')
      return
    }
    throw error
  }
  if (reply.kind === 'pending') throw new EstimatorError('Estimate is still running', true)

  const task = await prisma.task.findUnique({ where: { id: payload.taskId }, select: { id: true, costEstimateSource: true } })
  const project = await prisma.project.findUnique({ where: { id: payload.projectId }, select: { goalsAndGuardrails: true } })
  if (!task || !project) return
  const stated = storedGoalsAndGuardrails(project.goalsAndGuardrails as never)
  const done = await finishWithResult(
    {
      taskId: task.id,
      projectId: payload.projectId,
      inputsDigest: payload.inputsDigest,
      costSource: task.costEstimateSource,
      scope: { goalIds: new Set(stated.goals.map(g => g.id)), guardrailIds: new Set(stated.guardrails.map(g => g.id)) },
    },
    `service:${service.key}`,
    payload.requestedById,
    reply.result,
    false,
  )
  if (!done.ok) log.warn({ taskId: payload.taskId, reason: done.reason }, 'Estimator result was not usable')
}

/** A person's own estimate. Validated like any other; never confidence-forced, never from an agent. */
export async function recordHumanEstimate(
  taskId: string,
  userId: string,
  raw: unknown,
  projectId?: string,
): Promise<EstimateResult<EstimateView>> {
  const task = await loadTask(taskId)
  if (!task) return { ok: false, status: 404, error: 'Task not found' }
  const built = buildContext(task, projectId)
  if (!built.ok) return built
  const ctx = built.value
  const body = sanitizeEstimate(raw, ctx.scope)
  if (isEmptyEstimate(body)) {
    return { ok: false, status: 422, error: 'Send at least one impact, a risk, a cost, an effort or a reach', reason: 'empty_estimate' }
  }
  const view = await persist(
    { taskId, projectId: ctx.projectId, inputsDigest: ctx.inputsDigest, costSource: task.costEstimateSource },
    'human',
    'human/v1',
    userId,
    body,
  )
  return { ok: true, value: view }
}

export interface TaskEstimatesView {
  taskId: string
  latest: EstimateView | null
  history: EstimateView[]
}

/** The latest estimate and the history behind it, newest first. */
export async function getTaskEstimates(taskId: string, projectId?: string): Promise<EstimateResult<TaskEstimatesView>> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } })
  if (!task) return { ok: false, status: 404, error: 'Task not found' }
  const rows = await prisma.taskEstimate.findMany({
    where: { taskId, ...(projectId ? { projectId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
  })
  const history = rows.map(estimateView)
  return { ok: true, value: { taskId, latest: history[0] ?? null, history } }
}
