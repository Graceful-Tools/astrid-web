/**
 * Writing to the task cost ledger. (Task 315949e1, phase 0.)
 *
 * The ledger is append-only. A wrong price is corrected with a compensating
 * event, never an UPDATE, so this module exposes no way to edit or delete an
 * event — that is a deliberate omission, not a missing feature.
 *
 * `costMicrocents` is supplied by the reporter rather than computed here,
 * because the reporter is the only party that knows which price list was in
 * force when the work ran. Storing the tokens as well means a wrong price is
 * always detectable after the fact.
 *
 * MICROCENTS, not cents (task 315949e1, Jon's call). Model prices are quoted
 * per million tokens and a single call routinely costs a fraction of a cent,
 * so cents would round almost every event to zero. 1 dollar = 100,000,000
 * microcents.
 *
 * CACHE TOKENS ARE THEIR OWN FIELDS, also Jon's call: cache reads bill at
 * roughly a tenth of ordinary input and cache writes at a premium above it, so
 * folding them into inputTokens would misprice exactly the long, heavily-cached
 * agent runs this feature exists to measure.
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
  /** Optional: absent means the provider reported none, which is a real zero. */
  cacheReadTokens?: unknown
  cacheWriteTokens?: unknown
  costMicrocents?: unknown
  externalId?: string | null
}): Promise<RecordCostResult> {
  const {
    taskId, aiAgentId, provider, model, inputTokens, outputTokens,
    cacheReadTokens, cacheWriteTokens, costMicrocents, externalId,
  } = args

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

  // Absent is allowed and means zero: a provider that reports no cache usage
  // has told us something true. A PRESENT but malformed value is still
  // rejected — that is a reporter bug, not a measurement.
  const cacheRead = cacheReadTokens === undefined ? 0 : cacheReadTokens
  const cacheWrite = cacheWriteTokens === undefined ? 0 : cacheWriteTokens
  if (!isNonNegativeInteger(cacheRead)) {
    return { ok: false, status: 400, error: 'cacheReadTokens must be a non-negative integer' }
  }
  if (!isNonNegativeInteger(cacheWrite)) {
    return { ok: false, status: 400, error: 'cacheWriteTokens must be a non-negative integer' }
  }

  // costMicrocents may be NEGATIVE: that is how a compensating event corrects
  // a wrong price without mutating history. It must still be an integer —
  // money here is whole microcents, and a float would make sums drift.
  if (typeof costMicrocents !== 'number' || !Number.isInteger(costMicrocents)) {
    return { ok: false, status: 400, error: 'costMicrocents must be an integer number of microcents' }
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
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        costMicrocents,
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
export async function getTaskActualCostMicrocents(taskId: string): Promise<number> {
  const result = await prisma.taskCostEvent.aggregate({
    where: { taskId },
    _sum: { costMicrocents: true },
  })
  // No events is zero spent, not unknown — the caller decides whether to draw
  // anything, and phase 0 draws nothing.
  return result._sum.costMicrocents ?? 0
}
