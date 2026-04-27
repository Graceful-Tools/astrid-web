/**
 * Agent Task Comments API
 *
 * GET /api/v1/agent/tasks/:id/comments — list comments
 * POST /api/v1/agent/tasks/:id/comments — post a comment
 */

import { type NextRequest, NextResponse } from 'next/server'
import { authenticateAgentRequest } from '@/lib/agent-protocol'
import { prisma } from '@/lib/prisma'
import { broadcastToUsers } from '@/lib/sse-utils'
import { getListMemberIds } from '@/lib/list-member-utils'
import { UnauthorizedError, ForbiddenError } from '@/lib/api-auth-middleware'
import { checkAgentRateLimit, addRateLimitHeaders, AGENT_RATE_LIMITS } from '@/lib/agent-rate-limiter'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.agent.tasks.comments')

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateAgentRequest(req)

    const rateCheck = await checkAgentRateLimit(req, auth, AGENT_RATE_LIMITS.COMMENTS)
    if (rateCheck.response) return rateCheck.response

    const { id } = await context.params

    // Verify agent has access to this task
    const task = await prisma.task.findFirst({
      where: { id, assigneeId: auth.userId },
      select: { id: true },
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const comments = await prisma.comment.findMany({
      where: { taskId: id },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            isAIAgent: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    return addRateLimitHeaders(
      NextResponse.json({
        comments: comments.map(c => ({
          id: c.id,
          content: c.content,
          authorName: c.author?.name || c.author?.email || null,
          authorId: c.author?.id || c.authorId,
          isAgent: c.author?.isAIAgent ?? false,
          createdAt: new Date(c.createdAt).toISOString(),
        })),
      }),
      rateCheck.headers
    )
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: (error as Error).message }, { status: 403 })
    }
    log.error({ err: error }, 'GET /agent/tasks/:id/comments error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateAgentRequest(req, ['tasks:read', 'comments:write'])

    const rateCheckPost = await checkAgentRateLimit(req, auth, AGENT_RATE_LIMITS.COMMENTS)
    if (rateCheckPost.response) return rateCheckPost.response

    const { id } = await context.params

    // Verify agent has access
    const task = await prisma.task.findFirst({
      where: { id, assigneeId: auth.userId },
      include: {
        lists: {
          include: {
            listMembers: {
              include: { user: { select: { id: true } } },
            },
          },
        },
      },
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Rate limit: max 10 comments per task per minute per agent
    const recentComments = await prisma.comment.count({
      where: {
        taskId: id,
        authorId: auth.userId,
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
    })
    if (recentComments >= 10) {
      return NextResponse.json({ error: 'Rate limit: max 10 comments per minute per task' }, { status: 429 })
    }

    const body = await req.json()
    if (!body.content || typeof body.content !== 'string') {
      return NextResponse.json({ error: 'content is required' }, { status: 400 })
    }

    // Enforce max length
    const content = body.content.slice(0, 10_000)

    const comment = await prisma.comment.create({
      data: {
        content,
        taskId: id,
        authorId: auth.userId,
        type: 'MARKDOWN',
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            isAIAgent: true,
          },
        },
      },
    })

    // Broadcast to relevant users
    try {
      const userIds = new Set<string>()
      if (task.creatorId) userIds.add(task.creatorId)
      for (const list of task.lists || []) {
        const memberIds = getListMemberIds(list as any)
        memberIds.forEach(id => userIds.add(id))
      }
      userIds.delete(auth.userId) // Don't notify ourselves

      if (userIds.size > 0) {
        // Build AgentComment-compatible object for SDK consumers
        const agentComment = {
          id: comment.id,
          content: comment.content,
          authorName: comment.author?.name || comment.author?.email || null,
          authorId: comment.authorId,
          isAgent: comment.author?.isAIAgent ?? false,
          createdAt: new Date(comment.createdAt).toISOString(),
        }
        broadcastToUsers(Array.from(userIds), {
          type: 'comment_created',
          timestamp: new Date().toISOString(),
          data: {
            taskId: id,
            commentId: comment.id,
            listNames: (task.lists || []).map((l: any) => l.name),
            comment: agentComment,
          },
        })
      }
    } catch (err) {
      log.error({ err }, 'SSE broadcast error')
    }

    return addRateLimitHeaders(
      NextResponse.json(
        {
          comment: {
            id: comment.id,
            content: comment.content,
            authorName: comment.author?.name || comment.author?.email || null,
            authorId: auth.userId,
            isAgent: true,
            createdAt: new Date(comment.createdAt).toISOString(),
          },
        },
        { status: 201 }
      ),
      rateCheckPost.headers
    )
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: (error as Error).message }, { status: 403 })
    }
    log.error({ err: error }, 'POST /agent/tasks/:id/comments error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
