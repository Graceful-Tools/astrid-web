/**
 * The rules a list save carries beyond writing its columns (AWTD-1401).
 *
 * The legacy PUT /api/lists/:id enforced these inline; PUT /api/v1/lists/:id —
 * the route every client saves through — never learned them. They live here so
 * the route asks one place before the write and one place after it.
 *
 * Clients PUT the WHOLE list object on every save (web's settings panels, every
 * iOS/Mac build), so each guard acts only on a field that CHANGES. An unchanged
 * stale value — a default assignee who has since left, a status list's own
 * `listType` — must not turn an unrelated rename into a 400.
 */

import { createLogger } from '@/lib/logger'
import { isRealAssigneeId } from '@/lib/default-assignee'
import { canConvertListFlavor } from '@/lib/list-flavors'
import { hasListAccess } from '@/lib/list-member-utils'
import { broadcastListEvent } from '@/lib/lists/v1-list-shape'
import { audienceForList } from '@/lib/deletion-log'
import { unassignTasksOnListGoingPublic } from '@/services/list-public-unassign'

const log = createLogger('services.list-update')

/** The stored list as the route loads it before the write. */
export interface ListBeforeUpdate {
  id: string
  ownerId: string
  privacy?: string | null
  listType?: string | null
  defaultAssigneeId?: string | null
  listMembers: Array<{ userId: string; role: string }>
}

/**
 * Reject a save that would break the list's invariants. Returns the 400 message,
 * or null when the save may proceed.
 */
export function validateListUpdate(
  before: ListBeforeUpdate,
  body: { defaultAssigneeId?: unknown; listType?: unknown },
): string | null {
  const assignee = body.defaultAssigneeId
  if (
    typeof assignee === 'string' &&
    assignee !== before.defaultAssigneeId &&
    isRealAssigneeId(assignee) &&
    !hasListAccess(before as never, assignee)
  ) {
    return 'Default assignee must be a current member of the list'
  }

  // Board columns hold invariants (a task in at most one status) that a
  // conversion would silently violate, so only regular ⇄ label is allowed.
  const listType = body.listType
  if (
    typeof listType === 'string' &&
    listType !== (before.listType || 'regular') &&
    !canConvertListFlavor(before.listType, listType)
  ) {
    return 'Only regular and label lists can be converted between each other'
  }

  return null
}

/**
 * Everything that follows a committed save: unassign a newly public list's
 * tasks, then tell the other members. Best-effort — the list IS saved, so
 * nothing here may become the reason the caller is told it failed.
 */
export async function afterListUpdated(args: {
  before: ListBeforeUpdate
  list: Record<string, unknown> & { privacy?: string | null }
  sharedFieldsChanged: boolean
  actor: { id: string; name?: string | null }
}): Promise<void> {
  const { before, list, sharedFieldsChanged, actor } = args

  // A public list has no assignees (AWTD-1109). Only on the transition: a later
  // save of an already-public list must not sweep tasks assigned since.
  if (list.privacy === 'PUBLIC' && before.privacy !== 'PUBLIC') {
    const { unassigned, failed } = await unassignTasksOnListGoingPublic({
      listId: before.id,
      actorId: actor.id,
      actorName: actor.name ?? undefined,
    })
    log.info({ listId: before.id, unassigned, failed }, 'List became public; unassigned its tasks')
  }

  if (!sharedFieldsChanged) return

  const recipients = audienceForList(before).filter(id => id !== actor.id)
  if (recipients.length === 0) return

  // Per-user favorite state is the caller's; each viewer gets their own in
  // `v1List` (AWTD-1046).
  const { isFavorite: _isFavorite, favoriteOrder: _favoriteOrder, ...data } = list
  try {
    await broadcastListEvent({ listId: before.id, recipients, type: 'list_updated', data })
  } catch (err) {
    log.error({ err, listId: before.id }, 'Failed to broadcast list_updated')
  }
}
