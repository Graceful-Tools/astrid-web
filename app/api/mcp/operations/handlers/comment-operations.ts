/**
 * Comment handling operations for MCP API
 */

import { prisma } from "@/lib/prisma"
import { broadcastToUsers } from "@/lib/sse-utils"
import { resolveMCPActor, getListMemberIdsByListId } from "./shared"
import { createLogger } from '@/lib/logger'
import { canUserManageList } from "@/lib/list-permissions"

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
      lists: {
        select: {
          id: true,
          name: true,
          color: true,
          privacy: true,
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

  const comment = await prisma.comment.create({
    data: {
      content: commentData.content,
      type: commentData.type || 'TEXT',
      authorId,
      taskId,
      parentCommentId: commentData.parentCommentId
    },
    include: {
      author: {
        select: { id: true, name: true, email: true }
      },
      secureFiles: true
    }
  })

  // Associate secure file if provided
  if (commentData.fileId) {
    try {
      await prisma.secureFile.update({
        where: {
          id: commentData.fileId,
          uploadedBy: userId // Security: only allow linking files uploaded by the user
        },
        data: {
          commentId: comment.id
        }
      })

      // Refetch the comment to include the associated file
      const updatedComment = await prisma.comment.findUnique({
        where: { id: comment.id },
        include: {
          author: {
            select: { id: true, name: true, email: true }
          },
          secureFiles: true
        },
      })

      if (updatedComment) {
        Object.assign(comment, updatedComment)
      }
    } catch (error) {
      log.error({ err: error }, 'Failed to associate file with comment:')
      // Don't fail the comment creation if file association fails
    }
  }

  // Broadcast SSE event for real-time updates
  try {
    const userIds = new Set<string>()

    // Get all members from all lists this task belongs to
    for (const list of task.lists) {
      const listMemberIds = await getListMemberIdsByListId(list.id)
      listMemberIds.forEach(id => userIds.add(id))
    }

    // Add task assignee and creator
    if (task.assigneeId) userIds.add(task.assigneeId)
    if (task.creatorId) userIds.add(task.creatorId)

    // Remove the comment author from notifications (don't notify yourself)
    userIds.delete(userId)

    if (userIds.size > 0) {
      log.info(`[MCP SSE] Broadcasting comment_created to ${userIds.size} users`)
      broadcastToUsers(Array.from(userIds), {
        type: 'comment_created',
        timestamp: new Date().toISOString(),
        data: {
          taskId: task.id,
          taskTitle: task.title,
          commentId: comment.id,
          commentContent: comment.content.substring(0, 100),
          commenterName: comment.author?.name || comment.author?.email || "Someone",
          userId,
          listNames: Array.isArray(task.lists) ? task.lists.map(list => list.name) : [],
          comment: {
            id: comment.id,
            content: comment.content,
            type: comment.type,
            createdAt: comment.createdAt,
            author: comment.author
          }
        }
      })
    }
  } catch (error) {
    log.error({ err: error }, '[MCP SSE] Failed to broadcast comment_created:')
    // Don't fail the operation if SSE fails
  }

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

  // Check permissions: comment author OR task/list owners/admins can delete
  const isCommentAuthor = existingComment.authorId === mcpToken.userId
  const isTaskCreator = task.creatorId === mcpToken.userId
  const isTaskAssignee = task.assigneeId === mcpToken.userId
  const isListOwnerOrAdmin = task.lists.some(
    (list) => canUserManageList({ id: mcpToken.userId }, list as never),
  )

  if (!isCommentAuthor && !isTaskCreator && !isTaskAssignee && !isListOwnerOrAdmin) {
    log.info(`[MCP deleteComment] Access denied for user ${mcpToken.userId} to delete comment ${commentId}`)
    throw new Error('You can only delete your own comments or comments on tasks you manage')
  }

  log.info(`[MCP deleteComment] Access granted. Deleting comment ${commentId}`)

  // Delete the comment
  await prisma.comment.delete({
    where: { id: commentId }
  })

  // Send SSE notification to all users with access to the task
  try {
    const userIds = new Set<string>()

    // Add task creator and assignee
    if (task.creatorId) userIds.add(task.creatorId)
    if (task.assigneeId) userIds.add(task.assigneeId)

    // Add all users who have access to the task through lists
    for (const list of task.lists) {
      if (list.ownerId) userIds.add(list.ownerId)

      // Add all list members (unified in listMembers table)
      list.listMembers.forEach((member) => userIds.add(member.userId))
    }

    if (userIds.size > 0) {
      broadcastToUsers(Array.from(userIds), {
        type: 'comment_deleted',
        timestamp: new Date().toISOString(),
        data: {
          taskId: task.id,
          taskTitle: task.title,
          commentId: existingComment.id,
          deletedByName: mcpToken.user?.name || mcpToken.user?.email || "Someone",
          userId: mcpToken.userId,
          listNames: task.lists.map((list) => list.name),
        }
      })
    }
  } catch (sseError) {
    log.error({ err: sseError }, "[MCP deleteComment] Failed to send SSE notifications:")
    // Continue - comment was still deleted
  }

  log.info(`[MCP deleteComment] Comment ${commentId} deleted successfully`)

  return { success: true, message: 'Comment deleted successfully' }
}
