/**
 * Which runtime may run THIS TASK, for the runtime-binding pilot (AWTD-1669).
 *
 * RFC docs/architecture/BUSINESS_RUNTIME_BINDING_RFC.md §5. The resolver
 * (lib/ai/runtime-binding-resolver.ts, AWTD-1667) answers for one board; work
 * arrives as a task, which can sit on several boards. This is the task-level
 * gate every execution surface consults: the agent queue, both claim services
 * and the server-side dispatch paths (assignment, comment, workflow resume,
 * approval commands, the Astrid mention reply).
 *
 * Inert unless BOTH ASTRID_RUNTIME_BINDING_RESOLVER and
 * ASTRID_RUNTIME_BINDING_SINGLE_BUSINESS are on (runtimeBindingPilotEnabled):
 * off, it answers `legacy` without reading anything, so every caller runs
 * exactly as before.
 *
 * On:
 *  - no bound board on the task          → `legacy` (today's path, unchanged)
 *  - bound boards that name different bindings, or an execution board that is
 *    not one of them                     → `denied: board-conflict`. Never "the
 *    first list" (Jon's decision 2, 2026-11-14).
 *  - every bound board evaluated by evaluateRuntimeBinding; the first denial wins
 *  - when a caller is asking for work (`principal` given), it must be the
 *    binding's enrolled runtime: its authenticated OAuth client id equals
 *    `runtimeSubjectId`. Anyone else → `denied: principal-not-runtime`.
 *
 * Unbound additional boards neither broaden nor block bound work: the binding
 * decides, and only for its own boards.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { runtimeBindingPilotEnabled } from '@/lib/env'
import type { AgentRuntimeResolution } from '@/lib/ai/runtime-binding-resolver'
import { createLogger } from '@/lib/logger'
import {
  BINDING_SELECT,
  RuntimeBindingDeniedError,
  deny,
  evaluateRuntimeBinding,
  type RuntimeBindingDenial,
  type RuntimeBindingPlan,
  type RuntimeBindingRecord,
} from '@/lib/ai/runtime-binding-resolver'
import { recordRuntimeBindingAudit, type RuntimeBindingAuditEventType } from '@/lib/runtime-binding/audit'

const log = createLogger('runtime-binding.task-runtime')

export type TaskRuntimeGate =
  | { kind: 'legacy' }
  | { kind: 'bound'; plan: RuntimeBindingPlan }
  | { kind: 'denied'; denial: RuntimeBindingDenial }

export interface TaskRuntimeInput {
  taskId: string
  agentEmail: string | null | undefined
  /**
   * The trusted execution board, when the operation names one (a claim's
   * `listId`). It must be one of the task's bound boards.
   */
  executionBoardId?: string | null
  /**
   * The authenticated runtime asking for the work: its OAuth client id, or
   * null when the caller authenticated some other way. Leave it UNDEFINED for
   * server-side dispatch, where nothing is being handed to a caller.
   */
  principal?: string | null
}

type GateClient = {
  task: Pick<Prisma.TransactionClient['task'], 'findUnique'>
  runtimeBinding: Pick<Prisma.TransactionClient['runtimeBinding'], 'findUnique'>
}

const LEGACY: TaskRuntimeGate = { kind: 'legacy' }

/** The authenticated runtime principal of a request: its OAuth client, never a user. */
export function runtimePrincipalOf(auth: { clientId?: string | null }): string | null {
  return auth.clientId?.trim() || null
}

export async function gateTaskRuntime(
  input: TaskRuntimeInput,
  db: GateClient = prisma,
): Promise<TaskRuntimeGate> {
  if (!runtimeBindingPilotEnabled()) return LEGACY

  let lists: Array<{ id: string; runtimeBindingId: string | null }>
  try {
    const task = await db.task.findUnique({
      where: { id: input.taskId },
      select: { lists: { select: { id: true, runtimeBindingId: true } } },
    })
    lists = task?.lists ?? []
  } catch (err) {
    // Whether the task is bound is unknown, so it is treated as bound: a
    // lookup failure must never become personal dispatch (RFC §5 step 2).
    log.warn({ err, taskId: input.taskId }, 'task board lookup failed; denying')
    return { kind: 'denied', denial: deny('', input.executionBoardId ?? '', 'binding-lookup-failed') }
  }

  const bound = lists
    .filter((list): list is { id: string; runtimeBindingId: string } => !!list.runtimeBindingId)
    .sort((a, b) => a.id.localeCompare(b.id))
  if (bound.length === 0) return LEGACY

  const bindingIds = [...new Set(bound.map(list => list.runtimeBindingId))].sort()
  const executionBoardId = input.executionBoardId ?? bound[0].id
  if (bindingIds.length > 1 || !bound.some(list => list.id === executionBoardId)) {
    return { kind: 'denied', denial: deny(bindingIds[0], executionBoardId, 'board-conflict') }
  }

  const bindingId = bindingIds[0]
  let row: RuntimeBindingRecord | null
  try {
    row = await db.runtimeBinding.findUnique({ where: { id: bindingId }, select: BINDING_SELECT })
  } catch (err) {
    log.warn({ err, bindingId }, 'runtime binding lookup failed; denying')
    return { kind: 'denied', denial: deny(bindingId, executionBoardId, 'binding-lookup-failed') }
  }
  if (!row) return { kind: 'denied', denial: deny(bindingId, executionBoardId, 'binding-missing') }

  return decideBoundTask(row, bound.map(list => list.id), executionBoardId, input)
}

/**
 * The bound half, pure: every bound board must accept this agent under this
 * binding, and the asking principal must be the binding's runtime.
 */
export function decideBoundTask(
  binding: RuntimeBindingRecord,
  boundBoardIds: string[],
  executionBoardId: string,
  input: Pick<TaskRuntimeInput, 'agentEmail' | 'principal'>,
): Exclude<TaskRuntimeGate, { kind: 'legacy' }> {
  let plan: RuntimeBindingPlan | null = null
  for (const boardId of boundBoardIds) {
    const result = evaluateRuntimeBinding(binding, boardId, input.agentEmail)
    if (result.kind === 'denied') return { kind: 'denied', denial: result }
    if (boardId === executionBoardId) plan = result.plan
  }
  if (!plan) return { kind: 'denied', denial: deny(binding.id, executionBoardId, 'board-conflict') }
  if (input.principal !== undefined && (!input.principal || input.principal !== plan.runtimeSubjectId)) {
    return { kind: 'denied', denial: deny(binding.id, executionBoardId, 'principal-not-runtime') }
  }
  return { kind: 'bound', plan }
}

/**
 * Which bound boards may this caller DISCOVER work on, as a Prisma list filter
 * for `lists.none`: a task with any bound board outside the returned set is
 * hidden. Only consulted when the pilot is on.
 *
 * A board is discoverable only when the caller is its binding's runtime
 * subject AND the binding accepts this agent on that board. Failure to read
 * the bindings hides every bound board: discovery fails closed.
 */
export async function hiddenBoundBoardsFilter(input: {
  principal: string | null | undefined
  agentEmail: string
}): Promise<Prisma.TaskListWhereInput> {
  const everyBoundBoard: Prisma.TaskListWhereInput = { runtimeBindingId: { not: null } }
  if (!input.principal) return everyBoundBoard

  let bindings: RuntimeBindingRecord[]
  try {
    bindings = await prisma.runtimeBinding.findMany({
      where: { runtimeSubjectId: input.principal, state: 'active' },
      select: BINDING_SELECT,
    })
  } catch (err) {
    log.warn({ err }, 'runtime binding discovery lookup failed; hiding every bound board')
    return everyBoundBoard
  }

  const eligible = bindings.flatMap(binding => {
    const boards = binding.allowedBoardIds.filter(
      boardId => evaluateRuntimeBinding(binding, boardId, input.agentEmail).kind === 'bound',
    )
    return boards.length > 0 ? [{ runtimeBindingId: binding.id, id: { in: boards } }] : []
  })
  return eligible.length > 0 ? { ...everyBoundBoard, NOT: { OR: eligible } } : everyBoundBoard
}

/**
 * Record a denial. Best effort ON PURPOSE: RFC §7, "Denied operations remain
 * explicit errors even if a secondary diagnostic sink is unavailable" — the
 * caller has already decided to refuse, and an audit outage must not change
 * that answer either way.
 */
export async function auditRuntimeBindingDenial(
  denial: RuntimeBindingDenial,
  context: {
    eventType: Extract<RuntimeBindingAuditEventType, 'claim-denied' | 'resolution-denied' | 'capacity-exhausted'>
    operation: string
    taskId?: string
    actorUserId?: string | null
    agentEmail?: string | null
    principal?: string | null
  },
): Promise<void> {
  // A row that does not exist cannot be referenced (the relation is Restrict);
  // its id goes in the details instead.
  const missing = denial.reason === 'binding-missing'
  try {
    await recordRuntimeBindingAudit(prisma, {
      bindingId: missing ? null : denial.bindingId || null,
      eventType: context.eventType,
      actorUserId: context.actorUserId ?? null,
      actorPrincipal: context.agentEmail ?? null,
      boardIds: denial.boardId ? [denial.boardId] : [],
      reasonCode: denial.reason,
      details: {
        operation: context.operation,
        ...(context.taskId ? { taskId: context.taskId } : {}),
        ...(context.principal ? { runtimePrincipal: context.principal } : {}),
        ...(missing && denial.bindingId ? { missingBindingId: denial.bindingId } : {}),
      },
    })
  } catch (err) {
    log.warn({ err, reason: denial.reason, bindingId: denial.bindingId }, 'runtime binding denial audit failed; denial stands')
  }
}

/**
 * Should a SERVER-SIDE dispatch path stand down for this task? (AWTD-1669)
 *
 * Assignment and comment notifiers, coding-workflow resume, approval commands
 * and the Astrid mention reply all push work somewhere: a user webhook, the
 * env-configured remote, a provider call on somebody's key, a workflow. For a
 * bound board none of that is allowed (RFC §5, "no opportunistic fallback to a
 * different runtime or payer"):
 *
 *  - `legacy`: null — dispatch exactly as today;
 *  - `bound`: the pilot runtime POLLS, so the task is already where it will be
 *    found. Nothing is pushed and no MCP token is minted;
 *  - `denied`: nothing is pushed, and the denial is audited.
 *
 * Returns why it stood down, for the caller's log line, or null to proceed.
 */
export async function boundDispatchHold(input: {
  taskId: string
  agentEmail: string | null | undefined
  operation: string
  actorUserId?: string | null
}): Promise<string | null> {
  const gate = await gateTaskRuntime({ taskId: input.taskId, agentEmail: input.agentEmail })
  if (gate.kind === 'legacy') return null
  if (gate.kind === 'bound') {
    return `bound to runtime binding ${gate.plan.bindingId}: its polling runtime takes this from the queue`
  }
  await auditRuntimeBindingDenial(gate.denial, {
    eventType: 'resolution-denied',
    operation: input.operation,
    taskId: input.taskId,
    actorUserId: input.actorUserId,
    agentEmail: input.agentEmail,
  })
  return `runtime binding denied (${gate.denial.reason}): nothing is dispatched`
}

/**
 * The agent queue's half of the pilot (AWTD-1669), applied after the per-board
 * resolver has answered. Pilot off: null with no reads, and the resolver's own
 * denial (AWTD-1667) still throws exactly as before.
 *
 *  - A NAMED bound board answers only to its binding's runtime: anyone else
 *    gets `principal-not-runtime`. Every denial is audited.
 *  - Returns the `lists.none` filter that hides every task on a bound board
 *    this caller may not run — with or without listId, for the queue, the held
 *    count, the inbox and handbacks alike. A task that also sits on an unbound
 *    board stays hidden: unbound boards do not broaden a binding.
 */
export async function pilotQueueScope(input: {
  runtime: AgentRuntimeResolution
  userId: string
  agentEmail: string
  runtimePrincipal: string | null
}): Promise<Prisma.TaskListWhereInput | null> {
  const { runtime, runtimePrincipal } = input
  if (!runtimeBindingPilotEnabled()) {
    if (runtime.kind === 'denied') throw new RuntimeBindingDeniedError(runtime)
    return null
  }
  const denied =
    runtime.kind === 'denied'
      ? runtime
      : runtime.kind === 'bound' && runtime.plan.runtimeSubjectId !== runtimePrincipal
        ? deny(runtime.plan.bindingId, runtime.plan.boardId, 'principal-not-runtime')
        : null
  if (denied) {
    await auditRuntimeBindingDenial(denied, {
      eventType: 'resolution-denied',
      operation: 'agent-queue',
      actorUserId: input.userId,
      agentEmail: input.agentEmail,
      principal: runtimePrincipal,
    })
    throw new RuntimeBindingDeniedError(denied)
  }
  return hiddenBoundBoardsFilter({ principal: runtimePrincipal, agentEmail: input.agentEmail })
}
