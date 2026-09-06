import { BRAND } from '@/lib/brand/config'
import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import type { RouteContextParams } from '@/types/next'
import { createLogger } from '@/lib/logger'
import { createSafeErrorResponse } from '@/lib/logging/error-sanitizer'

const log = createLogger('tasks.[id].share-to-claude')


/**
 * Get OAuth access token for astrid.cc API
 */
async function getAstridOAuthToken(): Promise<string | null> {
  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    log.error('❌ OAuth credentials not configured')
    return null
  }

  try {
    const tokenResponse = await fetch(`https://${BRAND.domain}/api/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
      })
    })

    if (!tokenResponse.ok) {
      log.error({ body: await tokenResponse.text() }, '❌ Failed to obtain OAuth token')
      return null
    }

    const { access_token } = await tokenResponse.json()
    return access_token
  } catch (error) {
    log.error({ err: error }, '❌ OAuth token error:')
    return null
  }
}

/**
 * Share a task to ASTRID.cc for Claude assistance
 * POST /api/tasks/[id]/share-to-claude
 */
export async function POST(
  request: NextRequest,
  context: RouteContextParams<{ id: string }>
) {
  try {
    // Authentication check
    const session = await getUnifiedSession()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const { id: taskId } = await context.params
    if (!taskId) {
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      )
    }

    // Parse request body for additional context
    const body = await request.json().catch(() => ({}))
    const { shareReason, additionalNotes, targetListId } = body

    log.info(`🤖 [ShareToClaude] User ${session.user.email} sharing task ${taskId}`)

    // Get OAuth token
    const accessToken = await getAstridOAuthToken()
    if (!accessToken) {
      return NextResponse.json(
        { error: 'ASTRID.cc OAuth not configured. Please set ASTRID_OAUTH_CLIENT_ID and ASTRID_OAUTH_CLIENT_SECRET.' },
        { status: 503 }
      )
    }

    // Fetch the task with all necessary details
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        lists: {
          some: {
            OR: [
              { ownerId: session.user.id }, // User owns the list
              {
                listMembers: {
                  some: {
                    userId: session.user.id,
                    role: { in: ['admin', 'member'] }
                  }
                }
              }
            ]
          }
        }
      },
      include: {
        assignee: {
          select: { name: true, email: true }
        },
        creator: {
          select: { name: true, email: true }
        },
        lists: {
          select: {
            id: true,
            name: true,
            owner: { select: { name: true, email: true } }
          }
        },
        comments: {
          orderBy: { createdAt: 'desc' },
          take: 3, // Include recent comments for context
          include: {
            author: { select: { name: true, email: true } }
          }
        }
      }
    })

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found or you do not have permission to access it' },
        { status: 404 }
      )
    }

    // Use provided target list or default from env
    const listId = targetListId || process.env.ASTRID_OAUTH_LIST_ID
    if (!listId) {
      return NextResponse.json(
        { error: 'No target list specified. Provide targetListId or set ASTRID_OAUTH_LIST_ID.' },
        { status: 400 }
      )
    }

    // Create task on astrid.cc with formatted description
    const taskDescription = formatTaskDescriptionForClaude(task, shareReason, additionalNotes)
    const taskTitle = `🤖 ${task.title}`

    const createTaskResponse = await fetch(`https://${BRAND.domain}/api/v1/tasks`, {
      method: 'POST',
      headers: {
        'X-OAuth-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        listId,
        title: taskTitle,
        description: taskDescription,
        priority: task.priority,
        dueDateTime: task.dueDateTime?.toISOString(),
        isPrivate: false  // Allow Claude to see it
      })
    })

    if (!createTaskResponse.ok) {
      const error = await createTaskResponse.text()
      log.error({ err: error }, `❌ Failed to create task on ${BRAND.domain}:`)
      return NextResponse.json(
        { error: 'Failed to create task on ASTRID.cc' },
        { status: 500 }
      )
    }

    const createdTask = await createTaskResponse.json()
    const astridCCTaskId = createdTask.task?.id || createdTask.id
    const taskUrl = `https://${BRAND.domain}/tasks/${astridCCTaskId}`

    // Add a comment to local task indicating it was shared
    try {
      await prisma.task.update({
        where: { id: taskId },
        data: {
          comments: {
            create: {
              content: `🤖 Task shared to Claude for assistance via ASTRID.cc\n\n${shareReason ? `**Reason**: ${shareReason}\n` : ''}${additionalNotes ? `**Notes**: ${additionalNotes}\n` : ''}**ASTRID.cc Task**: ${taskUrl}`,
              type: 'TEXT',
              authorId: session.user.id
            }
          }
        }
      })
    } catch (commentError) {
      log.warn({ commentError }, '⚠️ Failed to add share comment to local task:')
      // Don't fail the request if comment creation fails
    }

    log.info({ astridCCTaskId }, '✅ [ShareToClaude] Task successfully shared:')

    return NextResponse.json({
      success: true,
      message: 'Task shared to Claude via ASTRID.cc',
      data: {
        astridCCTaskId,
        taskUrl,
        sharedAt: new Date().toISOString()
      }
    })

  } catch (error) {
    log.error({ err: error }, '❌ [ShareToClaude] Unexpected error:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Test ASTRID.cc OAuth connection
 * GET /api/tasks/[id]/share-to-claude (or any task ID for connection test)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getUnifiedSession()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    log.info(`🔍 [ShareToClaude] Testing ASTRID.cc OAuth connection for user ${session.user.email}`)

    const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
    const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      return NextResponse.json({
        configured: false,
        error: 'OAuth credentials not configured'
      })
    }

    // Try to get an OAuth token
    const accessToken = await getAstridOAuthToken()

    if (!accessToken) {
      return NextResponse.json({
        configured: true,
        connected: false,
        error: 'Failed to obtain OAuth token'
      })
    }

    // Test the connection by fetching lists
    const testResponse = await fetch(`https://${BRAND.domain}/api/v1/lists`, {
      headers: {
        'X-OAuth-Token': accessToken,
        'Content-Type': 'application/json'
      }
    })

    const connected = testResponse.ok

    return NextResponse.json({
      configured: true,
      connected,
      data: connected ? { message: 'OAuth connection successful' } : undefined,
      error: connected ? undefined : `Failed to connect to ${BRAND.domain} API`
    })

  } catch (error) {
    log.error({ err: error }, '❌ [ShareToClaude] Connection test error:')
    return NextResponse.json({
      configured: !!process.env.ASTRID_OAUTH_CLIENT_ID && !!process.env.ASTRID_OAUTH_CLIENT_SECRET,
      connected: false,
      ...createSafeErrorResponse(error, 'Connection test failed'),
    })
  }
}

/**
 * Format task description with comprehensive context for Claude
 */
function formatTaskDescriptionForClaude(
  task: any,
  shareReason?: string,
  additionalNotes?: string
): string {
  let description = task.description || ''

  // Add context section for Claude
  description += '\\n\\n---\\n**🤖 Shared to Claude for Assistance**\\n\\n'

  if (shareReason) {
    description += `**Why this was shared**: ${shareReason}\\n\\n`
  }

  // Add task metadata
  description += '**Task Details:**\\n'
  description += `- **Priority**: ${task.priority}/3\\n`
  description += `- **Status**: ${task.completed ? 'Completed' : 'In Progress'}\\n`

  if (task.dueDateTime) {
    description += `- **Due**: ${new Date(task.dueDateTime).toLocaleDateString()}\\n`
  }

  if (task.assignee) {
    description += `- **Assigned to**: ${task.assignee.name || task.assignee.email}\\n`
  }

  if (task.creator && task.creator.email !== task.assignee?.email) {
    description += `- **Created by**: ${task.creator.name || task.creator.email}\\n`
  }

  // Add recent comments for context
  if (task.comments && task.comments.length > 0) {
    description += '\\n**Recent Comments:**\\n'
    task.comments.forEach((comment: any, index: number) => {
      if (index < 3) { // Limit to 3 most recent
        const author = comment.author?.name || comment.author?.email || 'Unknown'
        const date = new Date(comment.createdAt).toLocaleDateString()
        description += `- **${author}** (${date}): ${comment.content.substring(0, 100)}${comment.content.length > 100 ? '...' : ''}\\n`
      }
    })
  }

  if (additionalNotes) {
    description += `\\n**Additional Context**: ${additionalNotes}\\n`
  }

  description += `\\n*This task was shared from a local ${BRAND.appName} instance for AI assistance.*`

  return description
}
