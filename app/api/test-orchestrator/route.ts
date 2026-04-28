import { NextResponse } from 'next/server'
import { AIOrchestrator } from '@/lib/ai-orchestrator'
import { createLogger } from '@/lib/logger'

const log = createLogger('test-orchestrator')


export async function POST(request: Request) {
  try {
    const { userId, taskId, workflowId } = await request.json()

    log.info('🧪 Testing AI Orchestrator...')
    log.info({ userId }, '   User ID:')
    log.info({ taskId }, '   Task ID:')
    log.info({ workflowId }, '   Workflow ID:')

    // Try to create orchestrator
    const orchestrator = await AIOrchestrator.createForTask(taskId, userId)
    log.info('✅ Orchestrator created successfully')

    // Return success
    return NextResponse.json({
      success: true,
      message: 'Orchestrator created successfully'
    })

  } catch (error) {
    log.error({ err: error }, '❌ Orchestrator test failed:')
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 })
  }
}
