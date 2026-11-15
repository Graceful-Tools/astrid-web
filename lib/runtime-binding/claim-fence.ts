/**
 * The capacity lease for bound work, fenced at claim time (AWTD-1669).
 *
 * RFC docs/architecture/BUSINESS_RUNTIME_BINDING_RFC.md §5 step 4 and §8
 * (AWTD-1555): queue discovery is advisory; the claim atomically revalidates
 * the plan and enforces `maxConcurrentRuns` across every agent and board that
 * shares the binding. Jon's decision 3 (2026-11-14): one polling runtime,
 * concurrency one.
 *
 * NO NEW TABLE. Occupancy is derived from the claims that already exist: an
 * incomplete task in Doing on a board bound to this binding holds one unit.
 * What makes it a fence rather than a check is the lock:
 *
 *   1. one interactive transaction takes `SELECT ... FOR UPDATE` on the
 *      binding's own row. Every bound claim for that binding queues behind it,
 *      on every server replica (the lock is in Postgres, not in a process), and
 *      so does every enrollment write, which updates the same row — a
 *      suspension, revocation or revision change cannot interleave with a claim;
 *   2. under the lock the task's boards and the binding are READ AGAIN and
 *      re-evaluated (gateTaskRuntime with the transaction client). A plan that
 *      went stale between the queue read and the claim — board detached or
 *      moved, binding suspended, revision bumped, agent removed — is refused;
 *   3. the executor's credential and payer are checked (executor-credential.ts);
 *   4. Doing tasks on the binding's boards, other than this one, are counted.
 *      At or above the limit the claim is refused as `capacity-exhausted`;
 *   5. the existing conditional claim update runs in the same transaction, and
 *      a `run-started` audit row is written with it. If that row cannot be
 *      written the claim rolls back (RFC §7: "New bound claims fail closed if
 *      their required audit/lease record cannot persist").
 *
 * Under READ COMMITTED the count in step 4 is a fresh statement taken after
 * the lock is granted, so it sees the Doing row the previous lock holder
 * committed. Two claims for the same binding therefore cannot both see zero.
 *
 * A stale lease is fenced the same way: the lease IS the Doing claim, so once
 * the existing release (scripts/lib/doing-release.ts, or a person) moves the
 * task out of Doing, capacity frees and the old worker's resume or pause has
 * to pass this fence again — against the binding as it is now.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { DOING_STATUS_ROLE } from '@/lib/task-status'
import { deny, type RuntimeBindingDenial, type RuntimeBindingPlan } from '@/lib/ai/runtime-binding-resolver'
import { recordRuntimeBindingAudit } from '@/lib/runtime-binding/audit'
import { executorGrantFor, isExecutorGrant } from '@/lib/runtime-binding/executor-credential'
import {
  auditRuntimeBindingDenial,
  gateTaskRuntime,
  type TaskRuntimeInput,
} from '@/lib/runtime-binding/task-runtime'

const log = createLogger('runtime-binding.claim-fence')

export type FencedClaimOutcome<T> =
  | { kind: 'done'; value: T }
  /** The plan changed between discovery and the claim: an ordinary lost race. */
  | { kind: 'stale' }
  | { kind: 'denied'; denial: RuntimeBindingDenial }

export interface FencedClaimInput<T> {
  /** The plan the advisory gate produced, outside the transaction. */
  plan: RuntimeBindingPlan
  /** Re-evaluated under the lock; `principal` must be set. */
  gate: TaskRuntimeInput & { principal: string | null }
  /** Who is acting, for the audit trail. */
  actorUserId: string
  operation: string
  /** False for writes that END or park a run (pause, release): no capacity check. */
  takesCapacity: boolean
  /** The existing conditional claim write, run on the transaction client. */
  write: (tx: Prisma.TransactionClient) => Promise<T>
  /** Did `write` start a run? Only then is `run-started` recorded. */
  started: (value: T) => boolean
}

export async function runFencedClaim<T>(input: FencedClaimInput<T>): Promise<FencedClaimOutcome<T>> {
  const { plan, gate } = input
  let outcome: FencedClaimOutcome<T>
  try {
    outcome = await prisma.$transaction(async (tx): Promise<FencedClaimOutcome<T>> => {
      await tx.$queryRaw`SELECT "id" FROM "RuntimeBinding" WHERE "id" = ${plan.bindingId} FOR UPDATE`

      const current = await gateTaskRuntime(gate, tx)
      if (current.kind === 'denied') return { kind: 'denied', denial: current.denial }
      if (current.kind === 'legacy' || current.plan.bindingId !== plan.bindingId) return { kind: 'stale' }

      const grant = executorGrantFor(current.plan)
      if (!isExecutorGrant(grant)) return { kind: 'denied', denial: grant }

      if (input.takesCapacity) {
        const occupied = await tx.task.count({
          where: {
            id: { not: gate.taskId },
            completed: false,
            statusRole: DOING_STATUS_ROLE,
            lists: { some: { runtimeBindingId: plan.bindingId } },
          },
        })
        if (occupied >= current.plan.maxConcurrentRuns) {
          return { kind: 'denied', denial: deny(plan.bindingId, current.plan.boardId, 'capacity-exhausted') }
        }
      }

      const value = await input.write(tx)
      if (input.started(value)) {
        await recordRuntimeBindingAudit(tx, {
          bindingId: current.plan.bindingId,
          bindingRevision: current.plan.revision,
          eventType: 'run-started',
          actorUserId: input.actorUserId,
          actorPrincipal: current.plan.agentMailbox,
          boardIds: [current.plan.boardId],
          details: {
            taskId: gate.taskId,
            operation: input.operation,
            runtimeSubjectId: current.plan.runtimeSubjectId,
            maxConcurrentRuns: current.plan.maxConcurrentRuns,
          },
        })
      }
      return { kind: 'done', value }
    })
  } catch (err) {
    // The lock, a re-read or the run-started row failed. Nothing was claimed
    // (the transaction rolled back) and nothing falls back.
    log.warn({ err, bindingId: plan.bindingId, taskId: gate.taskId }, 'fenced claim failed; denying')
    outcome = { kind: 'denied', denial: deny(plan.bindingId, plan.boardId, 'binding-lookup-failed') }
  }

  if (outcome.kind === 'denied') {
    await auditRuntimeBindingDenial(outcome.denial, {
      eventType: outcome.denial.reason === 'capacity-exhausted' ? 'capacity-exhausted' : 'claim-denied',
      operation: input.operation,
      taskId: gate.taskId,
      actorUserId: input.actorUserId,
      agentEmail: gate.agentEmail,
      principal: gate.principal,
    })
  }
  return outcome
}

/**
 * The advisory half, before any write: is this task bound, and may this
 * principal take it? A denial is audited as `claim-denied` here, so a claim
 * service only has to return it.
 */
export async function gateBoundClaim(
  gate: TaskRuntimeInput & { principal: string | null },
  context: { actorUserId: string; operation: string },
): Promise<Awaited<ReturnType<typeof gateTaskRuntime>>> {
  const result = await gateTaskRuntime(gate)
  if (result.kind === 'denied') {
    await auditRuntimeBindingDenial(result.denial, {
      eventType: 'claim-denied',
      operation: context.operation,
      taskId: gate.taskId,
      actorUserId: context.actorUserId,
      agentEmail: gate.agentEmail,
      principal: gate.principal,
    })
  }
  return result
}

/** A bound claim that asks for a transport the pilot does not run (e.g. native Copilot dispatch). */
export async function denyUnsupportedBoundTransport(
  plan: RuntimeBindingPlan,
  gate: TaskRuntimeInput & { principal: string | null },
  context: { actorUserId: string; operation: string },
): Promise<RuntimeBindingDenial> {
  const denial = deny(plan.bindingId, plan.boardId, 'transport-unsupported')
  await auditRuntimeBindingDenial(denial, {
    eventType: 'claim-denied',
    operation: context.operation,
    taskId: gate.taskId,
    actorUserId: context.actorUserId,
    agentEmail: gate.agentEmail,
    principal: gate.principal,
  })
  return denial
}
