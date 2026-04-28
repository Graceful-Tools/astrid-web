/**
 * ⚠️ DEPRECATED: Start tools-based AI coding workflow
 *
 * This endpoint has been deprecated in favor of AIOrchestrator.
 * All workflows now use the improved AIOrchestrator system.
 *
 * Date: January 11, 2025
 * Replacement: Direct AIOrchestrator.executeCompleteWorkflow() calls
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authConfig } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'
import { AIOrchestrator } from '@/lib/ai-orchestrator'
import { createLogger } from '@/lib/logger'

const log = createLogger('api.coding-workflow.start-tools-workflow')


export async function POST(request: NextRequest) {
  try {
    // Verify user session
    const session = await getServerSession(authConfig)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { taskId, repository, userComment } = await request.json()

    if (!taskId || !repository) {
      return NextResponse.json(
        { error: 'Missing required fields: taskId, repository' },
        { status: 400 }
      )
    }

    if (userComment) {
      log.info('🤖 [Tools Workflow] Starting for task:', taskId, '(responding to user comment)')
      log.info({ userComment }, '   User comment:')
    } else {
      log.info({ taskId }, '🤖 [Tools Workflow] Starting for task:')
    }

    // Get task and verify it exists
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignee: true,
        aiAgent: true,
        lists: {
          select: {
            aiAgentConfiguredBy: true,
            githubRepositoryId: true
          }
        }
      }
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Get the user who configured the AI agent (has API keys)
    // Find first list with a repository (task may be in multiple lists)
    const listWithRepo = task.lists?.find(l => l.githubRepositoryId)
    const configuredByUserId = listWithRepo?.aiAgentConfiguredBy || task.lists[0]?.aiAgentConfiguredBy || session.user.id

    // Get the AI agent ID (either from aiAgent or assignee)
    const aiAgentId = task.aiAgent?.id || (task.assignee?.isAIAgent ? task.assignee.id : null)
    if (!aiAgentId) {
      return NextResponse.json({ error: 'Task is not assigned to an AI agent' }, { status: 400 })
    }

    // Determine AI service from the assigned agent
    let aiService: 'claude' | 'openai' = 'claude' // default
    if (task.assignee?.isAIAgent && task.assignee.email) {
      if (task.assignee.email === 'claude@astrid.cc') {
        aiService = 'claude'
      } else if (task.assignee.email === 'openai@astrid.cc') {
        aiService = 'openai'
      }
    }

    log.info(`🤖 [Workflow] Determined AI service: ${aiService} for agent: ${task.assignee?.email}`)

    // Redirect to AIOrchestrator (improved Phase 1-3 system)
    log.info('🚀 [Workflow] Redirecting to AIOrchestrator...')
    log.info({ taskId }, '   Task ID:')
    log.info({ configuredByUserId }, '   User ID:')
    log.info({ repository }, '   Repository:')

    // Create AI Orchestrator using the static factory method
    const orchestrator = await AIOrchestrator.createForTaskWithService(taskId, configuredByUserId, aiService)

    // Create or find coding workflow record
    let workflow = await prisma.codingTaskWorkflow.findFirst({
      where: { taskId }
    })

    if (!workflow) {
      workflow = await prisma.codingTaskWorkflow.create({
        data: {
          taskId,
          status: 'PLANNING',
          aiService: aiService,
          metadata: {
            webhookTriggered: false,
            directAssignment: true,
            startedAt: new Date().toISOString()
          }
        }
      })
    }

    // Execute the AI workflow asynchronously
    const workflowId = workflow.id
    orchestrator.executeCompleteWorkflow(workflowId, taskId)
      .then(() => {
        log.info('✅ [Workflow] Completed successfully via AIOrchestrator')
      })
      .catch(async (error) => {
        log.error({ err: error }, '❌ [Workflow] Failed:')
        log.error(error.stack, '   Error stack:')

        // Update workflow status to FAILED to prevent stuck workflows
        try {
          await prisma.codingTaskWorkflow.update({
            where: { id: workflowId },
            data: {
              status: 'FAILED',
              metadata: {
                error: error.message,
                failedAt: new Date().toISOString()
              }
            }
          })
        } catch (e) {
          log.error({ err: e }, '❌ [Workflow] Failed to update workflow status:')
        }

        // Post error to task
        fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/tasks/${taskId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: `❌ **Workflow error**\n\n\`\`\`\n${error.message}\n\`\`\``,
            type: 'MARKDOWN'
          })
        }).catch(e => log.error({ err: e }, 'Failed to post error comment:'))
      })

    // Return immediately
    return NextResponse.json({
      success: true,
      message: 'Workflow started via AIOrchestrator',
      taskId
    })

  } catch (error) {
    log.error({ err: error }, '❌ [Tools Workflow] Error:')

    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
