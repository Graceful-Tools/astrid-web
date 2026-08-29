/**
 * Task Query Utilities
 *
 * Common Prisma includes and query helpers for task operations.
 * Reduces duplication across API routes and services.
 */

import { Prisma } from '@prisma/client'
import { PROJECT_ACCESS_INCLUDE } from '@/lib/list-permissions'

/**
 * Upper bound on comments embedded in a single task response.
 *
 * Task responses used to embed the ENTIRE comment collection; a runaway
 * GitHub comment-sync echo put 142k comments on one task, at which point the
 * task's PUT answered 500 — the write landed, the response could not
 * serialize (task a86b5bed). The cap keeps the NEWEST comments, so queries
 * using it must order newest-first; older comments remain reachable through
 * the comment endpoints.
 */
export const TASK_COMMENTS_RESPONSE_LIMIT = 500

/**
 * Standard task include for full task data with relations.
 * Used across GET, PUT, DELETE operations.
 */
export const TASK_FULL_INCLUDE = {
  assignee: true,
  creator: true,
  lists: {
    include: {
      owner: true,
      listMembers: {
        include: {
          user: true
        }
      },
      // Viewing a task must respect project membership too (task 6c20d125),
      // not just the ability to edit it.
      ...PROJECT_ACCESS_INCLUDE,
    },
  },
  comments: {
    include: {
      author: true,
      secureFiles: true,
    },
    orderBy: {
      createdAt: 'desc' as const,
    },
    take: TASK_COMMENTS_RESPONSE_LIMIT,
  },
  attachments: true,
  secureFiles: true,
} satisfies Prisma.TaskInclude

/**
 * Lean include for permission / state-diff checks performed BEFORE mutating a
 * task (PUT / DELETE). Only the list-membership tree is needed to authorize the
 * caller (owner + listMembers drive canAccessList) and to diff state-change
 * fields; the full comment thread + nested replies + attachments are
 * intentionally omitted so mutations don't over-fetch them.
 *
 * NOT for response bodies — those keep TASK_FULL_INCLUDE so the iOS-facing
 * task shape is unchanged.
 */
export const TASK_PERMISSION_INCLUDE = {
  assignee: true,
  creator: true,
  lists: {
    include: {
      owner: true,
      listMembers: {
        include: {
          user: true
        }
      },
      // Project membership cascades to project lists (task 6c20d125).
      // getUserRoleInList treats an absent `project` as "not loaded" and
      // under-grants, so every permission-bearing list query must include it or
      // project members silently lose the ability to edit tasks on the board.
      ...PROJECT_ACCESS_INCLUDE,
    },
  },
} satisfies Prisma.TaskInclude

/**
 * List include for operations that need member information.
 */
export const LIST_WITH_MEMBERS_INCLUDE = {
  owner: true,
  listMembers: {
    include: {
      user: true
    }
  },
  ...PROJECT_ACCESS_INCLUDE,
} satisfies Prisma.TaskListInclude

/**
 * Comment include for creating comments with replies.
 */
export const COMMENT_WITH_REPLIES_INCLUDE = {
  author: true,
  secureFiles: true,
  replies: {
    include: {
      author: true,
      secureFiles: true,
    },
    orderBy: {
      createdAt: 'asc' as const,
    },
  },
} satisfies Prisma.CommentInclude

/**
 * Type for a task with full relations.
 */
export type TaskWithFullRelations = Prisma.TaskGetPayload<{
  include: typeof TASK_FULL_INCLUDE
}>

/**
 * Type for a list with members.
 */
export type ListWithMembers = Prisma.TaskListGetPayload<{
  include: typeof LIST_WITH_MEMBERS_INCLUDE
}>

/**
 * Type for a comment with replies and secure files.
 */
export type CommentWithReplies = Prisma.CommentGetPayload<{
  include: typeof COMMENT_WITH_REPLIES_INCLUDE
}>

/**
 * Include for list with all relations (members, invites, count).
 */
export const LIST_FULL_INCLUDE = {
  owner: {
    select: { id: true, name: true, email: true, image: true }
  },
  listMembers: {
    include: {
      user: { select: { id: true, name: true, email: true, image: true } }
    }
  },
  listInvites: {
    select: { id: true, listId: true, email: true, role: true, token: true, createdAt: true, createdBy: true }
  },
  _count: {
    select: { tasks: true }
  }
} satisfies Prisma.TaskListInclude

/**
 * Type for a list with full relations.
 */
export type ListWithFullRelations = Prisma.TaskListGetPayload<{
  include: typeof LIST_FULL_INCLUDE
}>

/**
 * Type alias for list members from Prisma query result.
 */
export type ListMemberWithUser = Prisma.ListMemberGetPayload<{
  include: { user: true }
}>

/**
 * Type for a user with safe select (no password).
 */
export const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  isAIAgent: true,
  aiAgentType: true,
  createdAt: true,
} satisfies Prisma.UserSelect

export type SafeUser = Prisma.UserGetPayload<{
  select: typeof SAFE_USER_SELECT
}>

/**
 * Type for workflow metadata stored in JSON field.
 */
export interface WorkflowMetadata {
  cancelledAt?: string
  cancelReason?: string
  repository?: string
  branch?: string
  prNumber?: number
  [key: string]: unknown
}
