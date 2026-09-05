import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'
import { canDeleteComment, commentAudience } from "@/lib/comment-permissions"
import { reconcileTaskLifecycleAfterMutation } from "@/lib/agent-lifecycle-mutations"

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
    await reconcileTaskLifecycleAfterMutation(updatedComment.taskId)

    // Send SSE notification to all users with access to the task
    try {
      const task = existingComment.task
      // Editor stays in the audience: the client filters on data.userId below.
      const userIds = commentAudience(task)

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

    // Author, the people responsible for the task, or a list admin.
    if (!canDeleteComment(existingComment.authorId, task, session.user.id)) {
      return NextResponse.json({ error: "You can only delete your own comments or comments on tasks you manage" }, { status: 403 })
    }

    // Delete the comment
    await prisma.comment.delete({
      where: { id: commentId }
    })
    await reconcileTaskLifecycleAfterMutation(task.id)

    // Send SSE notification to all users with access to the task
    try {
      const userIds = commentAudience(task)

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
