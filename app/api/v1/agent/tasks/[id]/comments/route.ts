/**
 * Agent Task Comments API
 *
 * GET /api/v1/agent/tasks/:id/comments — list comments
 * POST /api/v1/agent/tasks/:id/comments — post a comment
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createCommentWithSideEffects } from '@/services/comment.service'
import { checkAgentRateLimit, addRateLimitHeaders, AGENT_RATE_LIMITS } from '@/lib/agent-rate-limiter'
import { withAgentAuth } from '@/lib/api-agent-auth-wrapper'
import { createLogger } from '@/lib/logger'

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
        // assignee and the two list columns are read by the post-comment side
        // effects (agent wake-up, repository routing). This route used to omit
        // them because it fired no side effects at all.
        assignee: {
          select: { id: true, email: true, name: true, isAIAgent: true, aiAgentType: true },
        },
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

    const outcome = await createCommentWithSideEffects({
      task: {
        id: task.id,
        title: task.title,
        creatorId: task.creatorId,
        assigneeId: task.assigneeId,
        assignee: task.assignee,
        lists: task.lists,
      },
      authorId: auth.userId,
      content,
      type: 'MARKDOWN',
    })

    if (outcome.kind === 'invalid') {
      return NextResponse.json({ error: outcome.error }, { status: 400 })
    }
    if (outcome.kind === 'conflict') {
      return NextResponse.json({ error: outcome.error }, { status: 409 })
    }

    const comment = outcome.comment

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
