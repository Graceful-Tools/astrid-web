import type { TaskList, User } from "@/types/task"
import { createLogger } from '@/lib/logger'

const log = createLogger('list-permissions')


/**
 * Minimal user interface for permission checks.
 * Accepts both full User objects and session user objects.
 */
interface UserLike {
  id: string
  email?: string | null
  name?: string | null
}

/**
 * Minimal list interface for permission checks.
 * Accepts both TaskList and Prisma query results.
 */
interface ListLike {
  // Needed to recognise built-in virtual lists (see isSystemListId).
  id?: string
  ownerId: string
  privacy?: string
  publicListType?: string | null
  listMembers?: Array<{
    userId: string
    role: string
    user?: { id: string; name?: string | null; email: string } | null
  }> | null
  owner?: { id: string; name?: string | null; email: string } | null
  // Legacy denormalized admins array. Some payloads carry only this (not
  // listMembers); ~8 inline call sites read it. getUserRoleInList unions it so
  // those sites can converge on this single source of truth (task e2803305).
  admins?: Array<{ id: string }> | null
  // Legacy denormalized members array, the sibling of `admins` above. Call
  // sites in task-detail read it directly; union it here so they can converge
  // on getUserRoleInList without losing access for those payloads.
  members?: Array<{ id: string }> | null
}

/**
 * Convert Prisma TaskList result to TaskList interface
 * Handles null -> undefined conversions for optional fields
 */
export function prismaToTaskList(prismaList: Record<string, unknown>): TaskList {
  return {
    ...prismaList,
    color: (prismaList.color as string) || undefined,
    description: (prismaList.description as string) || undefined,
    defaultAssigneeId: (prismaList.defaultAssigneeId as string) || undefined,
    defaultAssignee: (prismaList.defaultAssignee as User) || undefined,
    defaultPriority: (prismaList.defaultPriority as TaskList['defaultPriority']) || undefined,
    defaultRepeating: (prismaList.defaultRepeating as TaskList['defaultRepeating']) || undefined,
    defaultIsPrivate: (prismaList.defaultIsPrivate as boolean) ?? undefined,
    defaultDueDate: (prismaList.defaultDueDate as TaskList['defaultDueDate']) || undefined,
    tasks: (prismaList.tasks as TaskList['tasks']) || undefined,
  } as TaskList
}

/**
 * List Permission Management
 * Based on the same logic as quote_vote repository
 * 
 * Roles:
 * - Owner: Full control over the list (original creator)
 * - Admin: Can manage list settings and add/remove members (like managers)
 * - Member: Can add, edit, and manage tasks on the list
 * - Viewer: Can view tasks but not edit (for public lists)
 */

export function getUserRoleInList(user: UserLike, list: ListLike): "owner" | "admin" | "member" | "viewer" | null {
  if (!user || !list) return null

  // The list owner always has full control — match via ownerId OR the owner
  // relation object (some payloads carry `owner` but not `ownerId`).
  if (list.ownerId === user.id || list.owner?.id === user.id) {
    return "owner"
  }

  // Access comes from list membership (with or without the user relation loaded).
  const membership = list.listMembers?.find(
    (lm) => lm.userId === user.id || lm.user?.id === user.id
  )
  if (membership?.role === "admin") return "admin"

  // Legacy denormalized admins array grants admin (same precedence as the
  // inline `admins.some(...)` checks this consolidates), before member.
  if (list.admins?.some((a) => a?.id === user.id)) return "admin"

  if (membership?.role === "member") return "member"

  // Legacy denormalized members array (same precedence as membership member).
  if (list.members?.some((m) => m?.id === user.id)) return "member"

  // For public lists, users have viewer access
  if (list.privacy === "PUBLIC") {
    return "viewer"
  }

  return null
}

export function canUserViewList(user: UserLike, list: ListLike): boolean {
  const role = getUserRoleInList(user, list)
  return role !== null
}

export function canUserEditTasks(user: UserLike, list: ListLike): boolean {
  const role = getUserRoleInList(user, list)

  // For public copy-only lists (default), only owner/admin/member can add tasks
  if (list.privacy === "PUBLIC" && (list.publicListType === "copy_only" || !list.publicListType)) {
    return role === "owner" || role === "admin" || role === "member"
  }

  // For public collaborative lists, viewers can also add tasks
  if (list.privacy === "PUBLIC" && list.publicListType === "collaborative") {
    return role !== null // Anyone with access can add tasks (including viewers)
  }

  // Default: owner, admin, or member can edit
  return role === "owner" || role === "admin" || role === "member"
}

/**
 * Task-like interface for permission checks.
 */
interface TaskLike {
  id?: string
  title?: string
  creatorId: string | null
}

/**
 * Check if a user can edit a specific task
 * For collaborative lists: only task creator, list admin, or list owner can edit
 * For copy-only lists: only list admin or owner can edit
 */
export function canUserEditTask(user: UserLike, task: TaskLike, list: ListLike): boolean {
  const role = getUserRoleInList(user, list)

  // Only log in development mode and when debugging permissions
  if (process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DEBUG_PERMISSIONS === 'true') {
    log.info({
      userId: user.id,
      userEmail: user.email,
      taskId: task.id,
      taskTitle: task.title,
      listPrivacy: list.privacy,
      publicListType: list.publicListType,
      role: role,
      hasListMembers: !!list.listMembers?.length,
      listMembersUserIds: list.listMembers?.map((lm) => lm.userId)
    }, '🔐 canUserEditTask:')
  }

  // List owner and admins can always edit
  if (role === "owner" || role === "admin") {
    return true
  }

  // For public copy-only lists, only owner/admin/member can edit
  if (list.privacy === "PUBLIC" && (list.publicListType === "copy_only" || !list.publicListType)) {
    return role === "member"
  }

  // For public collaborative lists, task creator can edit their own tasks
  if (list.privacy === "PUBLIC" && list.publicListType === "collaborative") {
    return task.creatorId === user.id
  }

  // For non-public lists, members can edit
  return role === "member"
}

/**
 * Does the user hold an explicit role on this list (owner, admin or member)?
 *
 * Distinct from canUserEditTasks, which additionally grants viewers on public
 * collaborative lists. Several call sites need the narrower question — e.g.
 * "should we apply an optimistic update?", where a collaborative-list viewer
 * must be excluded or the write 403s. They spelled it out inline as
 * `isOwner || isAdmin || isMember || isListMember` (task e2803305).
 */
export function hasExplicitListRole(user: UserLike, list: ListLike): boolean {
  const role = getUserRoleInList(user, list)
  return role === "owner" || role === "admin" || role === "member"
}

export function canUserManageList(user: UserLike, list: ListLike): boolean {
  const role = getUserRoleInList(user, list)
  return role === "owner" || role === "admin"
}

export function canUserManageMembers(user: UserLike, list: ListLike): boolean {
  const role = getUserRoleInList(user, list)
  return role === "owner" || role === "admin"
}

export function canUserDeleteList(user: UserLike, list: ListLike): boolean {
  const role = getUserRoleInList(user, list)
  return role === "owner"
}

export function getListPermissionDescription(role: "owner" | "admin" | "member" | "viewer" | null): string {
  switch (role) {
    case "owner":
      return "Full control over the list"
    case "admin":
      return "Can manage list settings and members"
    case "member":
      return "Can add, edit, and manage tasks"
    case "viewer":
      return "Can view tasks but not edit"
    default:
      return "No access"
  }
}

export function getAvailableRolesToAssign(currentUserRole: "owner" | "admin" | "member" | "viewer" | null): ("owner" | "admin" | "member" | "viewer")[] {
  switch (currentUserRole) {
    case "owner":
      return ["admin", "member", "viewer"]
    case "admin":
      return ["member", "viewer"]
    default:
      return []
  }
}

/**
 * Check if a user can assign a specific role to another user
 */
export function canAssignRole(
  currentUser: UserLike,
  list: ListLike,
  targetRole: "owner" | "admin" | "member" | "viewer"
): boolean {
  const currentUserRole = getUserRoleInList(currentUser, list)
  const availableRoles = getAvailableRolesToAssign(currentUserRole)
  return availableRoles.includes(targetRole)
}

/**
 * Get all users who have access to a list with their roles
 */
export function getListMembers(list: ListLike): Array<{ user: UserLike; role: "owner" | "admin" | "member" | "viewer" }> {
  const members: Array<{ user: UserLike; role: "owner" | "admin" | "member" | "viewer" }> = []

  // Add owner
  if (list.owner) {
    members.push({ user: list.owner, role: "owner" })
  }

  // Add users from listMembers table
  list.listMembers?.forEach((lm) => {
    if (lm.user) {
      members.push({
        user: lm.user,
        role: lm.role as "owner" | "admin" | "member" | "viewer"
      })
    }
  })

  return members
}

/**
 * Check if the list has shared access (has admins or members)
 */
export function isListShared(list: ListLike): boolean {
  return !!(list.listMembers && list.listMembers.length > 0)
}

/**
 * Get the appropriate privacy setting for a new task based on list permissions
 */
export function getTaskPrivacyForList(list: ListLike): boolean {
  // If list is shared with others, tasks should default to not private
  // If list is private to owner only, tasks should default to private
  return list.privacy === "PRIVATE" && !isListShared(list)
}
/**
 * Built-in virtual lists. These are views Astrid provides, not lists anyone
 * owns, so their settings are never editable.
 *
 * Previously spelled out in three places — task-manager-utils.isVirtualListId,
 * MainContent's popover guards, and ListSettingsHost — which is how the set
 * drifts (task e2803305).
 */
export const SYSTEM_LIST_IDS = ["my-tasks", "today", "not-in-list", "public", "assigned"] as const

export function isSystemListId(listId: string): boolean {
  return (SYSTEM_LIST_IDS as readonly string[]).includes(listId)
}

/**
 * May this user change a list's settings?
 *
 * Canonical home for what task-manager-utils.canEditListSettings used to do
 * independently. It layered its own owner fallback on top of
 * list-member-utils.isListAdminOrOwner, which disagreed with getUserRoleInList
 * for lists carrying `ownerId` without a matching member row — the owner was
 * denied. Built on the single role lookup, that whole class of disagreement
 * disappears.
 */
export function canEditListSettings(list: ListLike | null | undefined, userId?: string | null): boolean {
  if (!list || !userId) return false
  if (isSystemListId(String(list.id))) return false
  return canUserManageList({ id: userId }, list)
}
