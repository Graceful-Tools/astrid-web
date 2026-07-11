/**
 * API endpoint to start AI orchestration for a coding workflow
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { AIOrchestrator } from '@/lib/ai-orchestrator'
import { getPreferredAIService } from '@/lib/api-key-cache'
import { createLogger } from '@/lib/logger'

const log = createLogger('coding-workflow.start-ai-orchestration')


export async function POST(request: NextRequest) {
  try {
    // Verify user session
    const session = await getUnifiedSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workflowId, taskId, userId } = await request.json()

    if (!workflowId || !taskId || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields: workflowId, taskId, userId' },
        { status: 400 }
      )
    }

    log.info({ workflowId, taskId, userId }, '🧠 [AI Orchestration] Starting workflow for:')

    // Create AI orchestrator instance with optimal configuration based on task's list
    let orchestrator
    try {
      log.info('🔧 [AI Orchestration] Creating orchestrator instance...')
      orchestrator = await AIOrchestrator.createForTask(taskId, userId)
      log.info('✅ [AI Orchestration] Orchestrator created successfully')
    } catch (createError) {
      log.error({ err: createError }, '❌ [AI Orchestration] Failed to create orchestrator:')
      throw createError // Re-throw to be caught by outer try-catch
    }

    // Start the complete workflow asynchronously
    // We don't await this to avoid timeout issues - it runs in the background
    log.info('🚀 [AI Orchestration] Starting executeCompleteWorkflow...')
    orchestrator.executeCompleteWorkflow(workflowId, taskId)
      .then(() => {
        log.info('✅ [AI Orchestration] Workflow completed successfully')
      })
      .catch((error) => {
        log.error({ err: error }, '❌ [AI Orchestration] Workflow failed:')
        log.error(error.stack, '❌ [AI Orchestration] Error stack:')

        // Update workflow status to FAILED to prevent stuck workflows
        prisma.codingTaskWorkflow.update({
          where: { id: workflowId },
          data: {
            status: 'FAILED',
            metadata: {
              error: error.message,
              failedAt: new Date().toISOString()
            }
          }
        }).catch(e => log.error({ err: e }, '❌ [AI Orchestration] Failed to update workflow status:'))
      })

    // Return immediately to avoid request timeout
    return NextResponse.json({
      success: true,
      message: 'AI orchestration started',
      workflowId
    })

  } catch (error) {
    log.error({ err: error }, '❌ [AI Orchestration] Error starting orchestration:')
    log.error({ type: error instanceof Error ? error.constructor.name : typeof error }, '❌ [AI Orchestration] Error type')
    if (error instanceof Error) {
      log.error({ message: error.message }, '❌ [AI Orchestration] Error message')
      log.error(error.stack, '❌ [AI Orchestration] Error stack:')
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
        type: error instanceof Error ? error.constructor.name : typeof error
      },
      { status: 500 }
    )
  }
}