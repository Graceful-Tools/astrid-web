import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'
import { canDeleteComment } from "@/lib/comment-permissions"
import {
  deleteCommentWithSideEffects,
  updateCommentWithSideEffects,
} from "@/services/comment.service"

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

    const updatedComment = await updateCommentWithSideEffects({
      commentId,
      content: content.trim(),
      task: existingComment.task,
      editor: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
      },
      include: {
        author: { select: { id: true, name: true, email: true, image: true } },
      },
    })

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

    await deleteCommentWithSideEffects({
      commentId,
      task,
      actor: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        isAIAgent: (session.user as { isAIAgent?: boolean }).isAIAgent,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: error }, "Error deleting comment:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
