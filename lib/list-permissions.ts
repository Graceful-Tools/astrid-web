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
  ownerId: string
  privacy?: string
  publicListType?: string | null
  listMembers?: Array<{
    userId: string
    role: string
    user?: { id: string; name?: string | null; email: string } | null
  }> | null
  owner?: { id: string; name?: string | null; email: string } | null
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

  // The list owner always has full control.
  if (list.ownerId === user.id) {
    return "owner"
  }

  // Access comes from list membership.
  const membership = list.listMembers?.find((lm) => lm.userId === user.id)
  if (membership?.role === "admin") return "admin"
  if (membership?.role === "member") return "member"

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