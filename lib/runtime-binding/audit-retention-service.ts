/**
 * The Prisma half of runtime-binding audit retention (AWTD-1670). The classes,
 * windows and where clauses live in ./audit-retention.ts; the nightly caller is
 * /api/cron/binding-audit.
 *
 * DELETES BY DEFAULT, unlike history retention's dry-run switch: Jon decided the
 * window, and no binding could exist before enrollment shipped, so there is no
 * backlog to size first.
 *
 * BOUNDED. Prisma's deleteMany has no LIMIT, so each batch selects up to
 * RUNTIME_BINDING_AUDIT_PRUNE_BATCH_SIZE ids, oldest first, and deletes those,
 * for at most RUNTIME_BINDING_AUDIT_PRUNE_MAX_BATCHES batches per class per run.
 * A backlog drains over several nights, and `capped` says one is left.
 *
 * IDEMPOTENT. The delete re-applies the retention filter alongside the ids, so a
 * row that stopped qualifying between the select and the delete stays, and a
 * second run over the same table deletes nothing.
 *
 * A failure throws: the cron answers 500 with the job named, rather than
 * reporting a successful retention run that deleted nothing.
 */

import { prisma as defaultPrisma } from '@/lib/prisma'
import { runtimeBindingAuditRetentionEnv } from '@/lib/env'
import { createLogger } from '@/lib/logger'
import {
  auditRetentionCutoffs,
  auditRetentionPolicy,
  lifecyclePruneWhere,
  operationalPruneWhere,
} from './audit-retention'

const log = createLogger('runtime-binding.audit-retention')

/** Rows per DELETE: small enough that no statement holds locks for long. */
export const RUNTIME_BINDING_AUDIT_PRUNE_BATCH_SIZE = 1_000

/** Batches per class per run, so one night stays inside the function time limit. */
export const RUNTIME_BINDING_AUDIT_PRUNE_MAX_BATCHES = 10

export interface RuntimeBindingAuditPruneSummary {
  operationalDays: number
  lifecycleDays: number
  operationalDeleted: number
  lifecycleDeleted: number
  /** True when a class hit the per-run cap: the next run has more to delete. */
  capped: boolean
}

/** Just enough of the client to prune, so a test can hand in a double. */
interface AuditEventDelegate {
  findMany(args: {
    where: unknown
    select: { id: true }
    orderBy: Array<Record<string, 'asc'>>
    take: number
  }): Promise<Array<{ id: string }>>
  deleteMany(args: { where: unknown }): Promise<{ count: number }>
}

interface PruneClient {
  runtimeBindingAuditEvent: AuditEventDelegate
}

async function pruneClass(
  delegate: AuditEventDelegate,
  where: unknown,
): Promise<{ deleted: number; capped: boolean }> {
  let deleted = 0
  for (let batch = 0; batch < RUNTIME_BINDING_AUDIT_PRUNE_MAX_BATCHES; batch++) {
    const rows = await delegate.findMany({
      where,
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: RUNTIME_BINDING_AUDIT_PRUNE_BATCH_SIZE,
    })
    if (rows.length === 0) return { deleted, capped: false }
    const { count } = await delegate.deleteMany({
      where: { AND: [where, { id: { in: rows.map(row => row.id) } }] },
    })
    deleted += count
    if (rows.length < RUNTIME_BINDING_AUDIT_PRUNE_BATCH_SIZE) return { deleted, capped: false }
  }
  return { deleted, capped: true }
}

export async function pruneRuntimeBindingAuditEvents({
  prisma = defaultPrisma as unknown as PruneClient,
  now = new Date(),
  env = runtimeBindingAuditRetentionEnv(),
}: {
  prisma?: PruneClient
  now?: Date
  env?: Parameters<typeof auditRetentionPolicy>[0]
} = {}): Promise<RuntimeBindingAuditPruneSummary> {
  const policy = auditRetentionPolicy(env)
  const cutoffs = auditRetentionCutoffs(now, policy)
  const delegate = prisma.runtimeBindingAuditEvent

  const operational = await pruneClass(delegate, operationalPruneWhere(cutoffs.operational))
  const lifecycle = await pruneClass(delegate, lifecyclePruneWhere(cutoffs.lifecycle))

  const summary: RuntimeBindingAuditPruneSummary = {
    ...policy,
    operationalDeleted: operational.deleted,
    lifecycleDeleted: lifecycle.deleted,
    capped: operational.capped || lifecycle.capped,
  }
  log.info({ ...summary, cutoffs }, 'Runtime-binding audit retention pruned')
  return summary
}
