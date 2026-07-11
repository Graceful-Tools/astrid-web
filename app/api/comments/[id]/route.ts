import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('comments.[id]')


export async function PUT(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: commentId } = await context.params
    const { content } = await request.json()

    if (!content || content.trim() === '') {
      return NextResponse.json({ error: "Comment content is required" }, { status: 400 })
    }

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
      return NextResponse.json({ error: "Comment not found" }, { status: 404 })
    }

    // Check permissions: only comment author can edit their own comments
    if (existingComment.authorId !== session.user.id) {
      return NextResponse.json({ error: "You can only edit your own comments" }, { status: 403 })
    }

    // Update the comment
    const updatedComment = await prisma.comment.update({
      where: { id: commentId },
      data: {
        content: content.trim(),
        updatedAt: new Date(),
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
    })

    // Send SSE notification to all users with access to the task
    try {
      const task = existingComment.task
      const userIds = new Set<string>()

      // Add task creator and assignee
      if (task.creatorId) userIds.add(task.creatorId)
      if (task.assigneeId) userIds.add(task.assigneeId)

      // Add all users who have access to the task through lists
      for (const list of task.lists) {
        if (list.ownerId) userIds.add(list.ownerId)

        // Add all list members (unified in listMembers table)
        list.listMembers.forEach(member => userIds.add(member.userId))
      }

      if (userIds.size > 0) {
        const { broadcastToUsers } = await import("@/lib/sse-utils")
        broadcastToUsers(Array.from(userIds), {
          type: 'comment_updated',
          timestamp: new Date().toISOString(),
          data: {
            taskId: task.id,
            taskTitle: task.title,
            commentId: updatedComment.id,
            commentContent: updatedComment.content.substring(0, 100), // First 100 chars for preview
            editorName: session.user.name || session.user.email || "Someone",
            userId: session.user.id, // Add userId for client-side filtering
            listNames: task.lists.map(list => list.name),
            comment: {
              id: updatedComment.id,
              content: updatedComment.content,
              type: updatedComment.type,
              author: updatedComment.author,
              createdAt: updatedComment.createdAt,
              updatedAt: updatedComment.updatedAt,
              parentCommentId: updatedComment.parentCommentId
            }
          }
        })
      }
    } catch (sseError) {
      log.error({ err: sseError }, "Failed to send comment update SSE notifications:")
      // Continue - comment was still updated
    }

    return NextResponse.json(updatedComment)
  } catch (error) {
    log.error({ err: error }, "Error updating comment:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: commentId } = await context.params

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
      return NextResponse.json({ error: "Comment not found" }, { status: 404 })
    }

    const task = existingComment.task

    // Check permissions: comment author OR task/list owners/admins can delete
    const isCommentAuthor = existingComment.authorId === session.user.id
    const isTaskCreator = task.creatorId === session.user.id
    const isTaskAssignee = task.assigneeId === session.user.id
    const isListOwnerOrAdmin = task.lists.some((list) => {
      if (list.ownerId === session.user.id) return true
      // Check if user is an admin via listMembers
      return list.listMembers?.some((lm: any) => lm.userId === session.user.id && lm.role === 'admin')
    })

    if (!isCommentAuthor && !isTaskCreator && !isTaskAssignee && !isListOwnerOrAdmin) {
      return NextResponse.json({ error: "You can only delete your own comments or comments on tasks you manage" }, { status: 403 })
    }

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
        list.listMembers.forEach(member => userIds.add(member.userId))
      }

      if (userIds.size > 0) {
        const { broadcastToUsers } = await import("@/lib/sse-utils")
        broadcastToUsers(Array.from(userIds), {
          type: 'comment_deleted',
          timestamp: new Date().toISOString(),
          data: {
            taskId: task.id,
            taskTitle: task.title,
            commentId: existingComment.id,
            deletedByName: session.user.name || session.user.email || "Someone",
            userId: session.user.id, // Add userId for client-side filtering
            listNames: task.lists.map(list => list.name),
          }
        })
      }
    } catch (sseError) {
      log.error({ err: sseError }, "Failed to send comment delete SSE notifications:")
      // Continue - comment was still deleted
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: error }, "Error deleting comment:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
