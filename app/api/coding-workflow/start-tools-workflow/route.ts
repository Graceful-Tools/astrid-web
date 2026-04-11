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
      console.log('🤖 [Tools Workflow] Starting for task:', taskId, '(responding to user comment)')
      console.log('   User comment:', userComment)
    } else {
      console.log('🤖 [Tools Workflow] Starting for task:', taskId)
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

    console.log(`🤖 [Workflow] Determined AI service: ${aiService} for agent: ${task.assignee?.email}`)

    // Redirect to AIOrchestrator (improved Phase 1-3 system)
    console.log('🚀 [Workflow] Redirecting to AIOrchestrator...')
    console.log('   Task ID:', taskId)
    console.log('   User ID:', configuredByUserId)
    console.log('   Repository:', repository)

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
        console.log('✅ [Workflow] Completed successfully via AIOrchestrator')
      })
      .catch(async (error) => {
        console.error('❌ [Workflow] Failed:', error)
        console.error('   Error stack:', error.stack)

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
          console.error('❌ [Workflow] Failed to update workflow status:', e)
        }

        // Post error to task
        fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/tasks/${taskId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: `❌ **Workflow error**\n\n\`\`\`\n${error.message}\n\`\`\``,
            type: 'MARKDOWN'
          })
        }).catch(e => console.error('Failed to post error comment:', e))
      })

    // Return immediately
    return NextResponse.json({
      success: true,
      message: 'Workflow started via AIOrchestrator',
      taskId
    })

  } catch (error) {
    console.error('❌ [Tools Workflow] Error:', error)

    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
