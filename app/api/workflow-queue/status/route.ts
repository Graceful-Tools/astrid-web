import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authConfig } from '@/lib/auth-config'
import { workflowQueue } from '@/lib/workflow-queue'
import { createLogger } from '@/lib/logger'

const log = createLogger('workflow-queue.status')


/**
 * GET /api/workflow-queue/status
 * Get workflow queue statistics
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authConfig)

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const stats = workflowQueue.getStats()

    return NextResponse.json({
      success: true,
      stats: {
        queueLength: stats.queueLength,
        activeWorkflows: stats.activeWorkflows,
        tokensUsed: stats.tokensUsedInWindow,
        tokenBudgetRemaining: stats.tokenBudgetRemaining,
        tokenBudgetTotal: 30000,
        nextAvailableSlot: stats.nextAvailableSlot.toISOString()
      }
    })
  } catch (error) {
    log.error({ err: error }, 'Error getting queue status:')
    return NextResponse.json(
      { error: 'Failed to get queue status' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/workflow-queue/status?taskId=xxx
 * Get status for a specific task
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authConfig)

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { taskId } = await request.json()

    if (!taskId) {
      return NextResponse.json({ error: 'taskId required' }, { status: 400 })
    }

    const taskStatus = workflowQueue.getTaskStatus(taskId)

    if (!taskStatus) {
      return NextResponse.json({
        success: true,
        status: 'not_found',
        message: 'Task not in queue or active workflows'
      })
    }

    return NextResponse.json({
      success: true,
      status: taskStatus.queued ? 'queued' : 'active',
      position: taskStatus.position
    })
  } catch (error) {
    log.error({ err: error }, 'Error getting task status:')
    return NextResponse.json(
      { error: 'Failed to get task status' },
      { status: 500 }
    )
  }
}
