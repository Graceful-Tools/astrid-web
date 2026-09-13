/**
 * Transferring a list's ownership — the rule, with no route around it.
 *
 * "Transfer Ownership & Leave" is ONE action: the successor becomes the owner
 * and the old owner is off the list when it returns. Both membership rows and
 * the `ownerId` move in a single `prisma.$transaction`, so there is no state in
 * which the list has an owner who is also a plain member, or — much worse — an
 * old owner already removed while ownership never moved, leaving a shared list
 * nobody can administer.
 *
 * Shared by `POST /api/lists/:id/transfer-ownership` and its v1 twin, the same
 * arrangement as lib/list-leave.ts (task e0613ae5): the routes are not
 * collapsed, because v1's response carries a `meta` envelope and legacy's does
 * not, so each keeps its own auth and formatting and shares the part that would
 * otherwise be duplicated. (Tasks 359ca48f, aa5a35f0.)
 */

import { prisma } from '@/lib/prisma'
import { RedisCache } from '@/lib/redis'
import { getUserRoleInList } from '@/lib/list-permissions'
import { createLogger } from '@/lib/logger'

const log = createLogger('list-ownership-transfer')

export type TransferListOwnershipResult =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404; error: string }

export async function transferListOwnership(args: {
  listId: string
  currentUserId: string
  newOwnerId: string
}): Promise<TransferListOwnershipResult> {
  const { listId, currentUserId, newOwnerId } = args

  if (!newOwnerId) {
    return { ok: false, status: 400, error: 'New owner ID is required' }
  }

  // Only `ownerId` is needed to decide this. The project relation is
  // deliberately NOT loaded: transfer is owner-only, and getUserRoleInList
  // resolves a project owner to "admin" rather than "owner" precisely so that
  // owning the board does not confer the power to give away a list someone
  // else owns. Not selecting it can only under-grant, never over-grant.
  const list = await prisma.taskList.findUnique({
    where: { id: listId },
    select: { id: true, ownerId: true },
  })
  if (!list) {
    return { ok: false, status: 404, error: 'List not found' }
  }

  if (getUserRoleInList({ id: currentUserId }, list) !== 'owner') {
    return { ok: false, status: 403, error: 'Only the owner can transfer ownership' }
  }

  // Transferring to yourself is genuinely nothing to do, and doing it "anyway"
  // is not harmless: the transaction would write the ownerId that is already
  // there and then delete the caller's own membership row, so the owner
  // quietly vanishes from the member list for no reason anyone asked for.
  //
  // Answered as success rather than 400 because it IS the requested end state —
  // you own the list — and because the legacy route has always returned 200
  // here (tests/api/ownership-transfer.test.ts). Only the stray delete goes.
  if (newOwnerId === currentUserId) {
    return { ok: true }
  }

  const newOwnerMember = await prisma.listMember.findFirst({
    where: { listId, userId: newOwnerId },
    select: { id: true },
  })
  if (!newOwnerMember) {
    return {
      ok: false,
      status: 400,
      error: 'New owner must be a current member of the list',
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.taskList.update({
      where: { id: listId },
      data: { ownerId: newOwnerId },
    })

    // The new owner's row goes because ownership is not expressed as
    // membership; the old owner's goes because they are leaving. `deleteMany`
    // covers the old owner having no row at all, and cleans up rather than
    // strands any duplicate rows a past bug may have left behind.
    await tx.listMember.deleteMany({
      where: { listId, userId: { in: [newOwnerId, currentUserId] } },
    })
  })

  // Best-effort: the transfer is committed, so a cold cache must not be
  // reported to the caller as a failed transfer they should retry.
  try {
    await RedisCache.invalidate.userListsAllVersions(currentUserId)
    await RedisCache.invalidate.userListsAllVersions(newOwnerId)
  } catch (error) {
    log.error(
      { err: error, listId, oldOwnerId: currentUserId, newOwnerId },
      'Failed to invalidate user-lists cache after ownership transfer'
    )
  }

  return { ok: true }
}
