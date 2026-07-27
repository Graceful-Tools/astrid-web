/**
 * API endpoint to create a coding workflow for a task
 */

import { agentEmail, UNKNOWN_CREATOR_EMAIL } from '@/lib/brand/agent-emails'
import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { isCodingAgent } from '@/lib/ai-agent-utils'
import { createLogger } from '@/lib/logger'
import { hasExplicitListRole } from "@/lib/list-permissions"

const log = createLogger('coding-workflow.create')


export async function POST(request: NextRequest) {
  try {
    // Verify user session
    const session = await getUnifiedSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { taskId, assigneeId, aiService, repositoryId } = body

    // Validate required fields
    if (!taskId || !assigneeId) {
      return NextResponse.json(
        { error: 'Missing required fields: taskId, assigneeId' },
        { status: 400 }
      )
    }

    // Verify the task exists and user has access
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        creator: true,
        assignee: true,
        lists: {
          include: {
            owner: true,
            listMembers: {
              include: {
                user: true
              }
            }
          }
        }
      }
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Check if user has permission to create workflow for this task
    const userHasAccess =
      task.creatorId === session.user.id ||
      task.assigneeId === session.user.id ||
      task.lists.some(list => hasExplicitListRole({ id: session.user.id }, list as never))

    if (!userHasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Verify assignee is a coding agent
    const assignee = await prisma.user.findUnique({
      where: { id: assigneeId },
      select: {
        id: true,
        isAIAgent: true,
        aiAgentType: true,
        isActive: true
      }
    })

    if (!assignee || !isCodingAgent(assignee)) {
      return NextResponse.json(
        { error: 'Assignee is not a coding agent' },
        { status: 400 }
      )
    }

    // Check if workflow already exists for this task
    const existingWorkflow = await prisma.codingTaskWorkflow.findUnique({
      where: { taskId }
    })

    if (existingWorkflow) {
      return NextResponse.json(
        { workflow: existingWorkflow, message: 'Workflow already exists' },
        { status: 200 }
      )
    }

    // Get list configuration for defaults - find first list with a repository (task may be in multiple lists)
    const taskList = task.lists.find(l => l.githubRepositoryId) || task.lists[0]
    const defaultRepositoryId = repositoryId || taskList?.githubRepositoryId || null
    const defaultAiService = aiService || taskList?.preferredAiProvider || 'claude'

    // Validate repository is configured
    if (!defaultRepositoryId) {
      return NextResponse.json(
        {
          error: 'No repository configured',
          message: 'Please configure a GitHub repository for this list in List Settings → Settings → Pick a repository',
          requiresSetup: true
        },
        { status: 400 }
      )
    }

    // Create the coding workflow
    const workflow = await prisma.codingTaskWorkflow.create({
      data: {
        taskId,
        repositoryId: defaultRepositoryId,
        aiService: defaultAiService,
        status: 'PENDING'
      },
      include: {
        task: {
          include: {
            creator: true,
            assignee: true
          }
        }
      }
    })

    log.info(`🤖 [CodingWorkflow] Created workflow ${workflow.id} for task ${taskId}`)

    // ✅ CRITICAL: Send webhook to user's Claude Code Remote server
    // This is the primary path for triggering AI coding agents
    try {
      const { aiAgentWebhookService } = await import('@/lib/ai-agent-webhook-service')
      const { getBaseUrl, getTaskUrl } = await import('@/lib/base-url')

      const assigneeUser = await prisma.user.findUnique({
        where: { id: assigneeId },
        select: { id: true, name: true, email: true, aiAgentType: true }
      })

      const baseUrl = getBaseUrl()
      const webhookPayload = {
        event: 'task.assigned' as const,
        timestamp: new Date().toISOString(),
        aiAgent: {
          id: assigneeUser?.id || assigneeId,
          name: assigneeUser?.name || 'Claude Agent',
          type: assigneeUser?.aiAgentType || 'claude_agent',
          email: assigneeUser?.email || agentEmail('claude'),
        },
        task: {
          id: task.id,
          title: task.title,
          description: task.description || '',
          priority: task.priority,
          dueDateTime: task.dueDateTime?.toISOString(),
          assigneeId: assigneeId,
          creatorId: task.creatorId,
          listId: taskList?.id || '',
          url: getTaskUrl(task.id),
        },
        list: {
          id: taskList?.id || '',
          name: taskList?.name || 'Default',
          githubRepositoryId: taskList?.githubRepositoryId || undefined,
        },
        mcp: {
          baseUrl,
          operationsEndpoint: `${baseUrl}/api/mcp/operations`,
          availableOperations: ['task.read', 'task.update', 'task.comment'],
          contextInstructions: 'Use the Astrid MCP server to interact with tasks.',
        },
        creator: {
          id: task.creatorId || session.user.id,
          name: task.creator?.name || session.user.name || undefined,
          email: task.creator?.email || session.user.email || UNKNOWN_CREATOR_EMAIL,
        },
      }

      log.info(`🚀 [CodingWorkflow] Sending webhook for task ${taskId} to creator ${task.creatorId}`)
      const webhookResult = await aiAgentWebhookService.sendToUserWebhook(
        task.creatorId || session.user.id,
        'task.assigned',
        webhookPayload
      )

      if (webhookResult.sent) {
        log.info(`✅ [CodingWorkflow] Webhook sent successfully to Claude Code Remote`)
      } else {
        log.info(`📋 [CodingWorkflow] No webhook configured, using cloud processing`)
      }
    } catch (webhookError) {
      log.error({ err: webhookError }, `❌ [CodingWorkflow] Webhook error (non-fatal):`)
      // Don't fail the request if webhook fails - workflow was created successfully
    }

    return NextResponse.json({
      workflow,
      message: 'Coding workflow created successfully'
    })

  } catch (error) {
    log.error({ err: error }, 'Error creating coding workflow:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}