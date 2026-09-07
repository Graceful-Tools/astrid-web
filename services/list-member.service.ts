/**
 * List-membership changes, in one place (epic 9dedd8aa).
 *
 * The third area the epic names, after tasks and comments, and the one where
 * the surfaces had drifted furthest. They did not merely duplicate work: they
 * emitted DIFFERENT EVENT NAMES and DIFFERENT PAYLOADS for the same act, and
 * the client had been patched to absorb it — `affectedMemberId()` in
 * hooks/task-manager/useTaskListState.ts exists only to try three spellings of
 * "who was affected" because three surfaces each picked their own.
 *
 * What that cost, before this file:
 *
 *   - A role change from iOS/Mac emitted `list_member_updated`, which
 *     useTaskListState does not handle. The member's permissions never changed
 *     in an open web client. The legacy name had the mirror-image bug:
 *     use-cache-sync does not handle `list_member_role_changed`, so that path
 *     left a stale cache. Each name was handled by one half of the client.
 *   - v1 add and remove sent no `listName`, so the toast read "You were
 *     removed from undefined".
 *   - v1 remove said `userId` where the client reads `removedMemberId`.
 *   - v1 add never invalidated the new member's cache, so the list they had
 *     just been given stayed missing from their own view.
 *   - Every membership change through MCP was invisible: no event at all, and
 *     a member cache left stale.
 *
 * Every payload below is the UNION of what the surfaces used to send, so no
 * client loses a field it reads today, and every spelling of the affected
 * member is present rather than the client guessing.
 */
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { broadcastToUsers } from '@/lib/sse-utils'
import { getListMemberIds } from '@/lib/list-member-utils'
import { invalidateMemberCache, invalidateMemberCaches } from '@/lib/list-member-operations'

const log = createLogger('services.list-member')

/** What the service needs about the list. Callers access-check it themselves. */
export interface MemberListContext {
  id: string
  name: string
  color?: string | null
  ownerId?: string | null
  listMembers?: Array<{ userId: string }> | null
}

export interface MemberActor {
  id: string
  name?: string | null
  email?: string | null
}

export interface AffectedMember {
  id: string
  name?: string | null
  email?: string | null
  image?: string | null
}

function actorLabel(actor: MemberActor): string {
  return actor.name || actor.email || 'Someone'
}

/**
 * Any membership change rewrites the roster, so it staleness-marks everyone's
 * cached view of the list, not only the person whose membership changed. The
 * legacy role-change path already invalidated the whole list; add and remove
 * invalidated only the affected member, and v1's add invalidated nobody. This
 * takes the widest of the three, which is the correct one.
 *
 * The affected member is invalidated on their own first because that call is
 * the one pinned by task e27642cc's regression test.
 */
async function invalidateForMembershipChange(
  list: MemberListContext,
  memberId: string,
): Promise<void> {
  await invalidateMemberCache(memberId)
  const others = audience(list).filter(id => id !== memberId)
  if (others.length > 0) await invalidateMemberCaches(others)
}

/** Everyone who can currently see the list, which is who a change concerns. */
function audience(list: MemberListContext): string[] {
  return getListMemberIds(list as never)
}

/**
 * Add a member: write, invalidate their cache, tell everyone.
 *
 * The audience is computed AFTER the write so the new member is in it — they
 * are the one person who most needs the event, and v1 computed it before.
 */
export async function addListMember(args: {
  list: MemberListContext
  member: AffectedMember
  role: string
  actor: MemberActor
}): Promise<void> {
  const { list, member, role, actor } = args

  await prisma.listMember.create({
    data: { listId: list.id, userId: member.id, role },
  })

  await invalidateForMembershipChange(list, member.id)

  broadcast(list, 'list_member_added', {
    listId: list.id,
    listName: list.name,
    listColor: list.color ?? null,
    inviterName: actorLabel(actor),
    // Three spellings on purpose: newMemberId is what useTaskListState reads
    // first, memberId is the legacy role/remove spelling, and `member` is the
    // object v1 clients read. Dropping any of them breaks a live reader.
    newMemberId: member.id,
    memberId: member.id,
    newMemberEmail: member.email ?? null,
    role,
    member: {
      id: member.id,
      name: member.name ?? null,
      email: member.email ?? null,
      image: member.image ?? null,
      role,
    },
  }, [member.id])
}

/**
 * Change a member's role.
 *
 * The event NAME is load-bearing: useTaskListState handles
 * `list_member_role_changed` and `list_admin_role_granted` and does not handle
 * `list_member_updated`, which is what v1 used to send — so a role change made
 * from iOS never reached an open web client. The admin variant is preserved
 * because the client shows a different toast for a promotion.
 */
export async function changeListMemberRole(args: {
  list: MemberListContext
  member: AffectedMember
  role: string
  actor: MemberActor
}): Promise<boolean> {
  const { list, member, role, actor } = args

  // updateMany, not update: the count is an authoritative "was there a row",
  // in one round trip and without throwing, which is how callers answer 404.
  // Two of the three surfaces already did it this way.
  const result = await prisma.listMember.updateMany({
    where: { listId: list.id, userId: member.id },
    data: { role },
  })
  if (result.count === 0) return false

  await invalidateForMembershipChange(list, member.id)

  broadcast(list, role === 'admin' ? 'list_admin_role_granted' : 'list_member_role_changed', {
    listId: list.id,
    listName: list.name,
    listColor: list.color ?? null,
    memberId: member.id,
    userId: member.id,
    updatedBy: actorLabel(actor),
    newRole: role,
    role,
  })

  return true
}

/**
 * Remove a member.
 *
 * The audience is taken BEFORE the delete, so the person removed still hears
 * that they were — otherwise the one client that must react is the one client
 * left out.
 */
export async function removeListMember(args: {
  list: MemberListContext
  member: AffectedMember
  actor: MemberActor
}): Promise<boolean> {
  const { list, member, actor } = args
  const recipients = audience(list)

  // deleteMany for the same reason changeListMemberRole uses updateMany: the
  // count answers "did this membership exist" without throwing.
  const result = await prisma.listMember.deleteMany({
    where: { listId: list.id, userId: member.id },
  })
  if (result.count === 0) return false

  await invalidateForMembershipChange(list, member.id)

  broadcastTo(recipients, 'list_member_removed', {
    listId: list.id,
    listName: list.name,
    listColor: list.color ?? null,
    removedMemberId: member.id,
    memberId: member.id,
    userId: member.id,
    removedBy: actorLabel(actor),
  })

  return true
}

function broadcast(
  list: MemberListContext,
  type: string,
  data: Record<string, unknown>,
  extraRecipients: string[] = [],
): void {
  broadcastTo([...audience(list), ...extraRecipients], type, data)
}

function broadcastTo(recipients: string[], type: string, data: Record<string, unknown>): void {
  try {
    const unique = Array.from(new Set(recipients))
    if (unique.length === 0) return

    broadcastToUsers(unique, {
      type,
      // Every membership event carries one; v1's three did not, and a consumer
      // that orders or de-duplicates on it saw undefined.
      timestamp: new Date().toISOString(),
      data,
    })
  } catch (err) {
    log.error({ err, type }, 'Failed to broadcast list membership event')
  }
}
