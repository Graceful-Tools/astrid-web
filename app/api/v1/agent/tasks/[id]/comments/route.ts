/**
 * Agent Task Comments API
 *
 * GET /api/v1/agent/tasks/:id/comments — list comments
 * POST /api/v1/agent/tasks/:id/comments — post a comment
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { broadcastToUsers } from '@/lib/sse-utils'
import { getListMemberIds } from '@/lib/list-member-utils'
import { checkAgentRateLimit, addRateLimitHeaders, AGENT_RATE_LIMITS } from '@/lib/agent-rate-limiter'
import { withAgentAuth } from '@/lib/api-agent-auth-wrapper'
import { createLogger } from '@/lib/logger'
import { reconcileTaskLifecycleAfterMutation } from '@/lib/agent-lifecycle-mutations'

const log = createLogger('v1.agent.tasks.comments')

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAgentAuth<RouteContext>(
  { requiredScopes: ['tasks:read'], tag: 'v1.agent.tasks.comments' },
  async (req, auth, { params }) => {
    const rateCheck = await checkAgentRateLimit(req, auth, AGENT_RATE_LIMITS.COMMENTS)
    if (rateCheck.response) return rateCheck.response

    const { id } = await params

    // Agents can only see comments on tasks assigned to them
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
  }
)

export const POST = withAgentAuth<RouteContext>(
  { requiredScopes: ['tasks:read', 'comments:write'], tag: 'v1.agent.tasks.comments' },
  async (req, auth, { params }) => {
    const rateCheckPost = await checkAgentRateLimit(req, auth, AGENT_RATE_LIMITS.COMMENTS)
    if (rateCheckPost.response) return rateCheckPost.response

    const { id } = await params

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

    // Per-task spam guard: max 10 comments per minute per agent
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
    await reconcileTaskLifecycleAfterMutation(id)

    try {
      const userIds = new Set<string>()
      if (task.creatorId) userIds.add(task.creatorId)
      for (const list of task.lists || []) {
        const memberIds = getListMemberIds(list as any)
        memberIds.forEach(id => userIds.add(id))
      }
      // Don't notify the agent about its own comment
      userIds.delete(auth.userId)

      if (userIds.size > 0) {
        // AgentComment-shaped object for SDK consumers
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
  }
)
