import { getUnifiedSession } from "@/lib/session-utils"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { createLogger } from '@/lib/logger'

const log = createLogger('events.poll')


export async function POST(request: NextRequest) {
  try {
    const session = await getUnifiedSession()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { since } = await request.json()
    const sinceDate = new Date(since)

    // Get recent events for this user
    const events = []

    // Get recent tasks (created or updated since the timestamp)
    const recentTasks = await prisma.task.findMany({
      where: {
        AND: [
          {
            OR: [
              { createdAt: { gte: sinceDate } },
              { updatedAt: { gte: sinceDate } }
            ]
          },
          {
            OR: [
              { assigneeId: session.user.id },
              { creatorId: session.user.id },
              {
                lists: {
                  some: {
                    OR: [
                      { ownerId: session.user.id },
                      { listMembers: { some: { userId: session.user.id } } },
                      { listMembers: { some: { userId: session.user.id } } },
                      { listMembers: { some: { userId: session.user.id } } }
                    ]
                  }
                }
              }
            ]
          }
        ]
      },
      include: {
        assignee: true,
        creator: true,
        lists: true
      },
      orderBy: { updatedAt: 'desc' },
      take: 20
    })

    // Convert tasks to events
    for (const task of recentTasks) {
      if (task.createdAt >= sinceDate && task.creatorId !== session.user.id) {
        events.push({
          type: 'task_created',
          timestamp: task.createdAt.toISOString(),
          data: {
            taskId: task.id,
            taskTitle: task.title,
            creatorName: task.creator?.name || task.creator?.email || 'Someone',
            listNames: task.lists.map(list => list.name),
            task: {
              id: task.id,
              title: task.title,
              description: task.description,
              priority: task.priority,
              completed: task.completed,
              assigneeId: task.assigneeId,
              creatorId: task.creatorId,
              createdAt: task.createdAt,
              updatedAt: task.updatedAt
            }
          }
        })
      } else if (task.updatedAt >= sinceDate && task.updatedAt > task.createdAt) {
        events.push({
          type: 'task_updated',
          timestamp: task.updatedAt.toISOString(),
          data: {
            taskId: task.id,
            taskTitle: task.title,
            updaterName: 'Someone', // We don't track who updated it
            listNames: task.lists.map(list => list.name),
            task: {
              id: task.id,
              title: task.title,
              description: task.description,
              priority: task.priority,
              completed: task.completed,
              assigneeId: task.assigneeId,
              creatorId: task.creatorId,
              createdAt: task.createdAt,
              updatedAt: task.updatedAt
            }
          }
        })
      }
    }

    // Get recent comments
    const recentComments = await prisma.comment.findMany({
      where: {
        AND: [
          { createdAt: { gte: sinceDate } },
          { authorId: { not: session.user.id } }, // Exclude own comments
          {
            task: {
              OR: [
                { assigneeId: session.user.id },
                { creatorId: session.user.id },
                {
                  lists: {
                    some: {
                      OR: [
                        { ownerId: session.user.id },
                        { listMembers: { some: { userId: session.user.id } } },
                        { listMembers: { some: { userId: session.user.id } } },
                        { listMembers: { some: { userId: session.user.id } } }
                      ]
                    }
                  }
                }
              ]
            }
          }
        ]
      },
      include: {
        author: true,
        task: {
          include: {
            lists: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 20
    })

    // Convert comments to events
    for (const comment of recentComments) {
      events.push({
        type: 'comment_created',
        timestamp: comment.createdAt.toISOString(),
        data: {
          taskId: comment.taskId,
          taskTitle: comment.task.title,
          commentId: comment.id,
          commentContent: comment.content.substring(0, 100),
          commenterName: comment.author?.name || comment.author?.email || 'Deleted User',
          listNames: comment.task.lists.map(list => list.name),
          comment: {
            id: comment.id,
            content: comment.content,
            type: comment.type,
            author: comment.author,
            createdAt: comment.createdAt,
            parentCommentId: comment.parentCommentId
          }
        }
      })
    }

    // Sort all events by timestamp
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    return NextResponse.json(events.slice(0, 20))
  } catch (error) {
    log.error({ err: error }, 'Error in polling endpoint:')
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}