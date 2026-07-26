/**
 * Tombstones for delta sync.
 *
 * Tasks and lists are hard-deleted, so an incremental sync (`updatedSince`) had
 * nothing to return for a row that no longer exists. Clients syncing
 * incrementally kept showing deleted tasks until a full refetch — which is why
 * the web reconcile had to remain a full download of every task.
 *
 * Recording a tombstone at delete time lets every client (web, iOS, Mac) learn
 * what disappeared, so `updatedSince` becomes safe to act on.
 *
 * Two rules shape this module:
 *
 *  - A deletion must never fail a delete. The user asked for the row to go; if
 *    the tombstone write fails, that is a sync inconvenience, not a reason to
 *    report failure for something that already happened.
 *  - A deletion id is information. `audienceIds` records who could see the
 *    entity when it went, so an id is only ever handed to someone who already
 *    knew it existed.
 */

import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('deletion-log')

export type DeletableEntity = 'task' | 'list'

/** How long tombstones are kept. Must comfortably exceed the sync cursor's 24h validity. */
export const DELETION_LOG_RETENTION_DAYS = 30

interface TaskAudienceSource {
  creatorId?: string | null
  assigneeId?: string | null
  lists?: Array<{ ownerId?: string | null; listMembers?: Array<{ userId?: string | null }> | null }> | null
}

interface ListAudienceSource {
  ownerId?: string | null
  listMembers?: Array<{ userId?: string | null }> | null
}

function compact(ids: Array<string | null | undefined>): string[] {
  return Array.from(new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0)))
}

/** Everyone who could see a task: its creator, assignee, and each list's owner and members. */
export function audienceForTask(task: TaskAudienceSource): string[] {
  const ids: Array<string | null | undefined> = [task.creatorId, task.assigneeId]
  for (const list of task.lists ?? []) {
    ids.push(list?.ownerId)
    for (const member of list?.listMembers ?? []) ids.push(member?.userId)
  }
  return compact(ids)
}

/** Everyone who could see a list: its owner and members. */
export function audienceForList(list: ListAudienceSource): string[] {
  return compact([list.ownerId, ...(list.listMembers ?? []).map(m => m?.userId)])
}

/**
 * Record that an entity was deleted. Call immediately after the delete, with an
 * audience captured BEFORE it (the relations are gone afterwards).
 */
export async function recordDeletion(
  entity: DeletableEntity,
  entityId: string,
  audienceIds: string[],
): Promise<void> {
  if (audienceIds.length === 0) return
  try {
    await prisma.deletionLog.create({
      data: { entity, entityId, audienceIds },
    })
  } catch (error) {
    // Deliberately swallowed — see the module header.
    log.error({ err: error, entity, entityId }, 'Failed to record deletion tombstone')
  }
}

/**
 * Ids of entities deleted since `since` that this user could see.
 *
 * Returns an empty list on failure: a delta that reports no deletions leaves
 * stale rows on screen, which is the pre-existing behaviour, whereas throwing
 * would break the whole sync.
 */
export async function getDeletionsSince(
  entity: DeletableEntity,
  userId: string,
  since: Date,
): Promise<string[]> {
  try {
    const rows = await prisma.deletionLog.findMany({
      where: {
        entity,
        deletedAt: { gt: since },
        audienceIds: { has: userId },
      },
      select: { entityId: true },
    })
    return rows.map(row => row.entityId)
  } catch (error) {
    log.error({ err: error, entity, userId }, 'Failed to read deletion tombstones')
    return []
  }
}

/** Drop tombstones older than the retention window. */
export async function pruneDeletionLog(): Promise<number> {
  const cutoff = new Date(Date.now() - DELETION_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  try {
    const { count } = await prisma.deletionLog.deleteMany({ where: { deletedAt: { lt: cutoff } } })
    return count
  } catch (error) {
    log.error({ err: error }, 'Failed to prune deletion tombstones')
    return 0
  }
}
