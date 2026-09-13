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
import type { V1UserSummary } from '@/lib/api-contracts/v1-ios-shapes'

const log = createLogger('list-ownership-transfer')

export type TransferListOwnershipResult =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404; error: string }

export type ListEligibleNewOwnersResult =
  | { ok: true; eligibleOwners: V1UserSummary[] }
  | { ok: false; status: 403 | 404; error: string }

/** The user fields an eligible-successor answer carries. */
const ELIGIBLE_OWNER_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  isAIAgent: true,
  aiAgentType: true,
} as const

type EligibleOwnerCandidate = {
  user?: { isAIAgent?: boolean | null } | null
}

/**
 * Can this member be handed the list?
 *
 * One predicate, deliberately, used by BOTH the successor picker and the
 * transfer itself (task f4b40af3). Split in two, the GET could hide a candidate
 * the POST would happily accept — the rule would exist twice and disagree, which
 * is the whole reason this is a server-side route rather than a filter each
 * client re-derives from the member list.
 *
 * **AI agents are not eligible.** An agent cannot accept a list or stand as its
 * billing authority, so handing one a list would leave it owned by something
 * that cannot answer for it.
 *
 * **Pending invitees are not eligible** — they are not members yet. That falls
 * out of reading `listMembers` only, rather than resting on a filter somebody
 * has to remember.
 *
 * A candidate whose `user` relation was not loaded is ineligible. Both callers
 * select it; a future query that stops doing so then refuses every transfer
 * loudly, rather than quietly treating agents as people.
 */
function isEligibleNewOwner(candidate: EligibleOwnerCandidate): boolean {
  if (!candidate.user) return false
  return !candidate.user.isAIAgent
}

/**
 * The members the caller may hand this list to.
 *
 * Owner-only, so it doubles as the "can I even offer this button?" probe a
 * client needs before rendering the control.
 */
export async function listEligibleNewOwners(args: {
  listId: string
  currentUserId: string
}): Promise<ListEligibleNewOwnersResult> {
  const { listId, currentUserId } = args

  const list = await prisma.taskList.findUnique({
    where: { id: listId },
    select: {
      id: true,
      ownerId: true,
      listMembers: {
        select: { userId: true, role: true, user: { select: ELIGIBLE_OWNER_USER_SELECT } },
      },
    },
  })
  if (!list) {
    return { ok: false, status: 404, error: 'List not found' }
  }

  // Only `ownerId` decides this, for the reason given on the transfer below.
  if (getUserRoleInList({ id: currentUserId }, { id: list.id, ownerId: list.ownerId }) !== 'owner') {
    return { ok: false, status: 403, error: 'Only the owner can transfer ownership' }
  }

  const eligibleOwners = list.listMembers
    .filter(member => member.userId !== currentUserId && isEligibleNewOwner(member))
    .map(({ user }) => ({
      id: user!.id,
      name: user!.name,
      email: user!.email,
      image: user!.image,
      isAIAgent: user!.isAIAgent ?? false,
      aiAgentType: user!.aiAgentType ?? null,
    }))

  return { ok: true, eligibleOwners }
}

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
    select: { id: true, user: { select: { isAIAgent: true } } },
  })
  if (!newOwnerMember) {
    return {
      ok: false,
      status: 400,
      error: 'New owner must be a current member of the list',
    }
  }

  // The same predicate the successor picker filters on, so the two cannot
  // disagree about who may be handed a list (task f4b40af3). Its own message:
  // "must be a current member" would be a lie about an agent that IS one.
  if (!isEligibleNewOwner(newOwnerMember)) {
    return {
      ok: false,
      status: 400,
      error: 'An AI agent cannot own a list',
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
