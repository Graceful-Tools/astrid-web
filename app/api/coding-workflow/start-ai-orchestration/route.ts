/**
 * API endpoint to start AI orchestration for a coding workflow
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authConfig } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'
import { AIOrchestrator } from '@/lib/ai-orchestrator'
import { getPreferredAIService } from '@/lib/api-key-cache'

export async function POST(request: NextRequest) {
  try {
    // Verify user session
    const session = await getServerSession(authConfig)
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

    console.log('🧠 [AI Orchestration] Starting workflow for:', { workflowId, taskId, userId })

    // Create AI orchestrator instance with optimal configuration based on task's list
    let orchestrator
    try {
      console.log('🔧 [AI Orchestration] Creating orchestrator instance...')
      orchestrator = await AIOrchestrator.createForTask(taskId, userId)
      console.log('✅ [AI Orchestration] Orchestrator created successfully')
    } catch (createError) {
      console.error('❌ [AI Orchestration] Failed to create orchestrator:', createError)
      throw createError // Re-throw to be caught by outer try-catch
    }

    // Start the complete workflow asynchronously
    // We don't await this to avoid timeout issues - it runs in the background
    console.log('🚀 [AI Orchestration] Starting executeCompleteWorkflow...')
    orchestrator.executeCompleteWorkflow(workflowId, taskId)
      .then(() => {
        console.log('✅ [AI Orchestration] Workflow completed successfully')
      })
      .catch((error) => {
        console.error('❌ [AI Orchestration] Workflow failed:', error)
        console.error('❌ [AI Orchestration] Error stack:', error.stack)

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
        }).catch(e => console.error('❌ [AI Orchestration] Failed to update workflow status:', e))
      })

    // Return immediately to avoid request timeout
    return NextResponse.json({
      success: true,
      message: 'AI orchestration started',
      workflowId
    })

  } catch (error) {
    console.error('❌ [AI Orchestration] Error starting orchestration:', error)
    console.error('❌ [AI Orchestration] Error type:', error instanceof Error ? error.constructor.name : typeof error)
    if (error instanceof Error) {
      console.error('❌ [AI Orchestration] Error message:', error.message)
      console.error('❌ [AI Orchestration] Error stack:', error.stack)
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