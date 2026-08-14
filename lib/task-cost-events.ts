/**
 * Writing to the task cost ledger. (Task 315949e1, phase 0.)
 *
 * The ledger is append-only. A wrong price is corrected with a compensating
 * event, never an UPDATE, so this module exposes no way to edit or delete an
 * event — that is a deliberate omission, not a missing feature.
 *
 * `costCents` is supplied by the reporter rather than computed here, because
 * the reporter is the only party that knows which price list was in force when
 * the work ran. Storing the tokens as well means a wrong price is always
 * detectable after the fact.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('task-cost-events')

export type RecordCostResult =
  | { ok: true; event: Record<string, unknown>; duplicate: boolean }
  | { ok: false; status: 400; error: string }

/** Guard against a mistyped field silently becoming 0 or NaN in the ledger. */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export async function recordTaskCost(args: {
  taskId: string
  aiAgentId?: string | null
  provider?: unknown
  model?: unknown
  inputTokens?: unknown
  outputTokens?: unknown
  costCents?: unknown
  externalId?: string | null
}): Promise<RecordCostResult> {
  const { taskId, aiAgentId, provider, model, inputTokens, outputTokens, costCents, externalId } = args

  if (typeof provider !== 'string' || provider.trim() === '') {
    return { ok: false, status: 400, error: 'provider is required' }
  }
  if (typeof model !== 'string' || model.trim() === '') {
    return { ok: false, status: 400, error: 'model is required' }
  }

  // Rejected rather than coerced. A ledger that accepts NaN or a negative token
  // count produces totals nobody can trust, and the whole point of this table
  // is that its sum is believable.
  if (!isNonNegativeInteger(inputTokens)) {
    return { ok: false, status: 400, error: 'inputTokens must be a non-negative integer' }
  }
  if (!isNonNegativeInteger(outputTokens)) {
    return { ok: false, status: 400, error: 'outputTokens must be a non-negative integer' }
  }

  // costCents may be NEGATIVE: that is how a compensating event corrects a
  // wrong price without mutating history. It must still be an integer — money
  // in this system is whole cents, and a float would make sums drift.
  if (typeof costCents !== 'number' || !Number.isInteger(costCents)) {
    return { ok: false, status: 400, error: 'costCents must be an integer number of cents' }
  }

  try {
    const event = await prisma.taskCostEvent.create({
      data: {
        taskId,
        aiAgentId: aiAgentId ?? null,
        provider: provider.trim(),
        model: model.trim(),
        inputTokens,
        outputTokens,
        costCents,
        externalId: externalId ?? null,
      },
    })

    return { ok: true, event: event as unknown as Record<string, unknown>, duplicate: false }
  } catch (err) {
    // A retried report must not be counted twice. The unique index on
    // (taskId, externalId) is what enforces it; landing here means the reporter
    // already succeeded and is retrying, so return the event it created rather
    // than an error.
    if (
      externalId &&
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const existing = await prisma.taskCostEvent.findFirst({
        where: { taskId, externalId },
      })
      if (existing) {
        log.info({ eventId: existing.id }, 'Idempotency hit (externalId): returning existing cost event')
        return { ok: true, event: existing as unknown as Record<string, unknown>, duplicate: true }
      }
    }
    throw err
  }
}

/**
 * A task's actual cost: the sum of its ledger.
 *
 * Deliberately a query rather than a denormalised column on Task. Add a cached
 * total only after a measurement shows this is slow, and say so in the commit.
 */
export async function getTaskActualCostCents(taskId: string): Promise<number> {
  const result = await prisma.taskCostEvent.aggregate({
    where: { taskId },
    _sum: { costCents: true },
  })
  // No events is zero spent, not unknown — the caller decides whether to draw
  // anything, and phase 0 draws nothing.
  return result._sum.costCents ?? 0
}
