/**
 * API endpoint to start AI orchestration for a coding workflow
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { getTaskForUser } from '@/services/task.service'
import { AIOrchestrator } from '@/lib/ai-orchestrator'
import { createLogger } from '@/lib/logger'

const log = createLogger('coding-workflow.start-ai-orchestration')


export async function POST(request: NextRequest) {
  try {
    // Verify user session
    const session = await getUnifiedSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workflowId, taskId } = await request.json()

    if (!workflowId || !taskId) {
      return NextResponse.json(
        { error: 'Missing required fields: workflowId, taskId' },
        { status: 400 }
      )
    }

    // AUTHORISE FIRST, and never from the body. This route used to take
    // `userId` from the request alongside `taskId` and hand both straight to
    // AIOrchestrator.createForTask, so any signed-in user could run a full
    // coding workflow against any task AS any other user — that user's AI API
    // keys, GitHub integration and repositories. Its sibling
    // start-tools-workflow carries the same fix and a comment describing the
    // same bug (task 017a569a); this route was missed. (Task 2b4330e0.)
    const access = await getTaskForUser(taskId, session.user.id)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    // A caller may pass a task they legitimately own together with somebody
    // else's workflow id. CodingTaskWorkflow.taskId is unique, so the workflow
    // must be this task's own or there is nothing here to run.
    const workflow = await prisma.codingTaskWorkflow.findUnique({
      where: { id: workflowId },
      select: { id: true, taskId: true },
    })
    if (!workflow || workflow.taskId !== taskId) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    log.info({ workflowId, taskId }, '🧠 [AI Orchestration] Starting workflow for:')

    // Create AI orchestrator instance with optimal configuration based on task's list
    let orchestrator
    try {
      orchestrator = await AIOrchestrator.createForTask(taskId, session.user.id)
    } catch (createError) {
      log.error({ err: createError }, '❌ [AI Orchestration] Failed to create orchestrator:')
      throw createError // Re-throw to be caught by outer try-catch
    }

    // Start the complete workflow asynchronously
    // We don't await this to avoid timeout issues - it runs in the background
    orchestrator.executeCompleteWorkflow(workflowId, taskId)
      .then(() => {
        log.info({ workflowId }, '✅ [AI Orchestration] Workflow completed successfully')
      })
      .catch((error: unknown) => {
        log.error({ err: error }, '❌ [AI Orchestration] Workflow failed:')

        // Update workflow status to FAILED to prevent stuck workflows
        prisma.codingTaskWorkflow.update({
          where: { id: workflowId },
          data: {
            status: 'FAILED',
            metadata: {
              error: error instanceof Error ? error.message : String(error),
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

    // The caller gets a generic message. This handler used to return
    // error.message and error.constructor.name, which leaks internals of the
    // orchestrator and of Prisma to anyone who can reach the route.
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
