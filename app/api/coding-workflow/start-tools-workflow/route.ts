/**
 * ⚠️ DEPRECATED: Start tools-based AI coding workflow
 *
 * This endpoint has been deprecated in favor of AIOrchestrator.
 * All workflows now use the improved AIOrchestrator system.
 *
 * Date: January 11, 2025
 * Replacement: Direct AIOrchestrator.executeCompleteWorkflow() calls
 *
 * The work itself lives in lib/coding-workflow/start-tools-workflow.ts so that
 * server callers can invoke it directly rather than fetching this app's own
 * HTTP API — see that file for why. This handler owns auth and nothing else.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { getTaskForUser } from '@/services/task.service'
import { startToolsWorkflow } from '@/lib/coding-workflow/start-tools-workflow'
import { createLogger } from '@/lib/logger'
import { createSafeErrorResponse } from '@/lib/logging/error-sanitizer'

const log = createLogger('api.coding-workflow.start-tools-workflow')

export async function POST(request: NextRequest) {
  try {
    const session = await getUnifiedSession()
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

    // AUTHORISE FIRST. This route once verified only that the caller was signed
    // in, so any authenticated user could start a coding workflow against
    // another user's task — reading it, and billing the run to the LIST OWNER,
    // since the API keys come from the list's aiAgentConfiguredBy rather than
    // from the caller. (Task 017a569a.)
    const access = await getTaskForUser(taskId, session.user.id)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    const result = await startToolsWorkflow({ taskId, repository, userComment })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    log.info({ taskId, workflowId: result.workflowId }, 'Workflow started')

    return NextResponse.json({
      success: true,
      message: 'Workflow started via AIOrchestrator',
      taskId,
    })
  } catch (error) {
    log.error({ err: error }, 'Error starting tools workflow')
    return NextResponse.json(createSafeErrorResponse(error), { status: 500 })
  }
}
