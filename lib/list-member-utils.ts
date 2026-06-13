/**
 * Comprehensive list member utilities
 *
 * This module provides utilities to consistently handle list membership
 * across the application, including owners, admins, and regular members.
 */

import type { TaskList, User, ListMember } from "@/types/task"
import type { ListWithMembers } from "@/lib/task-query-utils"
import { createLogger } from '@/lib/logger'

const log = createLogger('list-member-utils')


export interface ListMemberDefinition {
  id: string
  name?: string | null
  email: string
  image?: string | null
  role: 'owner' | 'admin' | 'member'
  isOwner: boolean
  isAdmin: boolean
  isMember: boolean
}

/**
 * Minimal interface for list-like objects with members.
 * Accepts both TaskList from types and Prisma query results.
 */
interface ListLike {
  owner?: { id: string; name?: string | null; email: string; image?: string | null } | null
  ownerId?: string
  listMembers?: Array<{
    userId: string
    role: string
    user?: { id: string; name?: string | null; email: string; image?: string | null } | null
  }> | null
  privacy?: string
  /**
   * Project this list belongs to (board sub-task #3). When fetched with the
   * project's members, project membership grants access to the list. Absent →
   * no project members are added, so behavior is identical to list-only.
   */
  project?: {
    ownerId?: string | null
    owner?: { id: string; name?: string | null; email: string; image?: string | null } | null
    members?: Array<{
      userId: string
      role: string
      user?: { id: string; name?: string | null; email: string; image?: string | null } | null
    }> | null
  } | null
}

/**
 * Get all members of a list (owners, admins, and members)
 * This provides a comprehensive view of all users who have access to the list
 */
export function getAllListMembers(list: ListLike): ListMemberDefinition[] {
  const members: ListMemberDefinition[] = []

  // Add owner
  if (list.owner) {
    members.push({
      id: list.owner.id,
      name: list.owner.name,
      email: list.owner.email,
      image: list.owner.image,
      role: 'owner',
      isOwner: true,
      isAdmin: false,
      isMember: false
    })
  }

  // Track existing IDs to avoid duplicates
  const existingIds = new Set(members.map(m => m.id))

  // Add members from listMembers table - handle both with and without user relation
  if (list.listMembers) {
    list.listMembers.forEach((member) => {
      // Handle case where member has user relation
      if (member.user && !existingIds.has(member.user.id)) {
        const memberRole = member.role === 'admin' ? 'admin' : 'member'
        members.push({
          id: member.user.id,
          name: member.user.name,
          email: member.user.email,
          image: member.user.image,
          role: memberRole,
          isOwner: false,
          isAdmin: memberRole === 'admin',
          isMember: memberRole === 'member'
        })
        existingIds.add(member.user.id)
      }
      // Handle case where we only have userId (without user relation loaded)
      // This is common when lists are fetched without including listMembers.user
      else if (!member.user && member.userId && !existingIds.has(member.userId)) {
        const memberRole = member.role === 'admin' ? 'admin' : 'member'
        members.push({
          id: member.userId,
          name: null, // User data not loaded
          email: '', // User data not loaded - could be enriched later if needed
          image: null,
          role: memberRole,
          isOwner: false,
          isAdmin: memberRole === 'admin',
          isMember: memberRole === 'member'
        })
        existingIds.add(member.userId)

        // Log in development for debugging
        if (process.env.NODE_ENV === 'development') {
          log.info({
            userId: member.userId,
            role: memberRole
          }, '[ListMembers] Added member without user relation:')
        }
      }
    })
  }

  // Add project members (board sub-task #3). A list inside a project grants
  // access to the project's owner and members even when they aren't direct
  // list members. Project owner / project-admins map to list `admin`, other
  // project members map to `member`. Additive only — never lowers an existing
  // entry (we skip IDs already added with a higher list-level role).
  if (list.project) {
    const project = list.project

    if (project.owner && !existingIds.has(project.owner.id)) {
      members.push({
        id: project.owner.id,
        name: project.owner.name,
        email: project.owner.email,
        image: project.owner.image,
        role: 'admin',
        isOwner: false,
        isAdmin: true,
        isMember: false
      })
      existingIds.add(project.owner.id)
    } else if (project.ownerId && !existingIds.has(project.ownerId)) {
      members.push({
        id: project.ownerId,
        name: null,
        email: '',
        image: null,
        role: 'admin',
        isOwner: false,
        isAdmin: true,
        isMember: false
      })
      existingIds.add(project.ownerId)
    }

    project.members?.forEach((member) => {
      const id = member.user?.id ?? member.userId
      if (!id || existingIds.has(id)) return
      const memberRole = member.role === 'admin' || member.role === 'owner' ? 'admin' : 'member'
      members.push({
        id,
        name: member.user?.name ?? null,
        email: member.user?.email ?? '',
        image: member.user?.image ?? null,
        role: memberRole,
        isOwner: false,
        isAdmin: memberRole === 'admin',
        isMember: memberRole === 'member'
      })
      existingIds.add(id)
    })
  }

  return members
}

/**
 * Check if a user has any access to a list (owner, admin, or member)
 */
export function hasListAccess(list: ListLike, userId: string): boolean {
  return getAllListMembers(list).some(member => member.id === userId)
}

/**
 * Check if a user is an admin or owner of a list
 */
export function isListAdminOrOwner(list: ListLike, userId: string): boolean {
  const allMembers = getAllListMembers(list)
  const member = allMembers.find(m => m.id === userId)

  return member ? (member.isOwner || member.isAdmin) : false
}

/**
 * Check if a user is the owner of a list
 */
export function isListOwner(list: ListLike, userId: string): boolean {
  return list.owner?.id === userId
}

/**
 * Get a user's role in a list
 */
export function getUserListRole(list: ListLike, userId: string): 'owner' | 'admin' | 'member' | null {
  const member = getAllListMembers(list).find(m => m.id === userId)
  return member?.role || null
}

/**
 * Get all user IDs who have access to a list (for SSE broadcasting)
 */
export function getListMemberIds(list: ListLike): string[] {
  return getAllListMembers(list).map(member => member.id)
}

/**
 * Check if a list is accessible by a user based on privacy settings
 */
export function canAccessList(list: ListLike, userId?: string): boolean {
  // Public lists are always accessible
  if (list.privacy === 'PUBLIC') {
    return true
  }

  // Private lists require membership
  if (list.privacy === 'PRIVATE' && userId) {
    return hasListAccess(list, userId)
  }

  return false
}