/**
 * Comment handling operations for MCP API
 */

import { prisma } from "@/lib/prisma"
import {
  createCommentWithSideEffects,
  deleteCommentWithSideEffects,
} from "@/services/comment.service"
import { resolveMCPActor, getListMemberIdsByListId } from "./shared"
import { createLogger } from '@/lib/logger'
import { canDeleteComment } from "@/lib/comment-permissions"

const log = createLogger('mcp.comment-operations')


export async function addComment(accessToken: string, taskId: string, commentData: any, userId: string, aiAgentId?: string) {
  log.info({
    taskId,
    commentData: typeof commentData === 'string' ? `STRING: "${commentData.substring(0, 50)}..."` : commentData,
    userId,
    aiAgentId
  }, '[MCP addComment] Called with:')

  // Note: Authentication already done by middleware, userId is the authenticated user

  // Verify task access and write permission
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      OR: [
        // User is task creator or assignee
        { creatorId: userId },
        { assigneeId: userId },
        // Or user has access via lists
        {
          lists: {
            some: {
              OR: [
                { ownerId: userId },
                { listMembers: { some: { userId } } }
              ]
            }
          }
        }
      ]
    },
    include: {
      // assignee and the two list columns feed the post-comment side effects
      // (agent wake-up, repository routing). This handler used to omit them
      // because it fired no side effects at all.
      assignee: {
        select: { id: true, email: true, name: true, isAIAgent: true, aiAgentType: true }
      },
      lists: {
        select: {
          id: true,
          name: true,
          color: true,
          privacy: true,
          githubRepositoryId: true,
          aiAgentConfiguredBy: true,
          listMembers: {
            include: {
              user: { select: { id: true, name: true, email: true } }
            }
          }
        }
      }
    }
  })

  if (!task) {
    log.error(`[MCP addComment] Task not found or access denied. TaskId: ${taskId}, UserId: ${userId}`)
    throw new Error('Task not found or access denied')
  }

  // Use AI agent ID as author if provided, otherwise use authenticated user
  const authorId = aiAgentId || userId

  // The audience MCP has always computed: members of every list the task is in,
  // resolved through its own query rather than the include.
  const additionalAudience: string[] = []
  for (const list of task.lists) {
    additionalAudience.push(...(await getListMemberIdsByListId(list.id)))
  }

  const outcome = await createCommentWithSideEffects({
    task: {
      id: task.id,
      title: task.title,
      creatorId: task.creatorId,
      assigneeId: task.assigneeId,
      assignee: task.assignee,
      lists: task.lists,
    },
    authorId,
    content: commentData.content,
    type: commentData.type || 'TEXT',
    parentCommentId: commentData.parentCommentId,
    ...(commentData.fileId
      ? { file: { id: commentData.fileId, linkerUserId: userId } }
      : {}),
    additionalAudience,
  })

  if (outcome.kind === 'invalid' || outcome.kind === 'conflict') {
    throw new Error(outcome.error)
  }

  const comment = outcome.comment

  // Transform secureFiles for iOS compatibility (name/size vs originalName/fileSize)
  const transformedComment = {
    ...comment,
    secureFiles: comment.secureFiles?.map((file) => ({
      id: file.id,
      name: file.originalName,
      size: file.fileSize,
      mimeType: file.mimeType
    }))
  }

  return {
    success: true,
    comment: transformedComment
  }
}

export async function getTaskComments(accessToken: string, taskId: string, userId: string) {
  const mcpToken = await resolveMCPActor(accessToken, userId)

  // Verify task access
  // Allow access if: 1) task is in a list user has access to, OR 2) user is the creator (for listless tasks), OR 3) task is in a PUBLIC list
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      OR: [
        {
          lists: {
            some: {
              OR: [
                { ownerId: mcpToken.userId },
                { listMembers: { some: { userId: mcpToken.userId } } },
                { listMembers: { some: { userId: mcpToken.userId } } },
                { listMembers: { some: { userId: mcpToken.userId } } }
              ]
            }
          }
        },
        {
          creatorId: mcpToken.userId
        },
        {
          // Allow access to tasks in PUBLIC lists
          lists: {
            some: {
              privacy: 'PUBLIC'
            }
          }
        }
      ]
    }
  })

  if (!task) {
    throw new Error('Task not found or access denied')
  }

  const comments = await prisma.comment.findMany({
    where: { taskId },
    include: {
      author: {
        select: { id: true, name: true, email: true }
      },
      secureFiles: true
    },
    orderBy: { createdAt: 'asc' }
  })

  // Transform secureFiles for iOS compatibility (name/size vs originalName/fileSize)
  const transformedComments = comments.map(comment => ({
    ...comment,
    secureFiles: comment.secureFiles?.map((file) => ({
      id: file.id,
      name: file.originalName,
      size: file.fileSize,
      mimeType: file.mimeType
    }))
  }))

  return { comments: transformedComments }
}

export async function deleteComment(accessToken: string, commentId: string, userId: string) {
  const mcpToken = await resolveMCPActor(accessToken, userId)

  log.info(`[MCP deleteComment] Attempting to delete comment ${commentId} for user ${mcpToken.userId}`)

  // Find the existing comment with task and permission info
  const existingComment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: {
      author: true,
      task: {
        include: {
          lists: {
            include: {
              owner: true,
              listMembers: true,
            },
          },
        },
      },
    },
  })

  if (!existingComment) {
    log.info(`[MCP deleteComment] Comment ${commentId} not found`)
    throw new Error('Comment not found')
  }

  const task = existingComment.task

  // Author, the people responsible for the task, or a list admin — through the
  // shared rule the other two delete surfaces already use. This handler
  // re-derived the same four clauses by hand; they happened to agree, and
  // "happened to agree" is what this epic exists to stop.
  if (!canDeleteComment(existingComment.authorId, task, mcpToken.userId)) {
    log.info(`[MCP deleteComment] Access denied for user ${mcpToken.userId} to delete comment ${commentId}`)
    throw new Error('You can only delete your own comments or comments on tasks you manage')
  }

  log.info(`[MCP deleteComment] Access granted. Deleting comment ${commentId}`)

  await deleteCommentWithSideEffects({
    commentId,
    task,
    actor: {
      id: mcpToken.userId,
      name: mcpToken.user?.name,
      email: mcpToken.user?.email,
      // The MCP actor is resolved from the token; its select carries no
      // isAIAgent, and an agent posting through MCP does so as its own user.
      isAIAgent: (mcpToken.user as { isAIAgent?: boolean } | undefined)?.isAIAgent,
    },
  })

  log.info(`[MCP deleteComment] Comment ${commentId} deleted successfully`)

  return { success: true, message: 'Comment deleted successfully' }
}
