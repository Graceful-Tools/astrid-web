/**
 * AI Agent Webhook Route
 *
 * Receives task assignment notifications and delegates to AIAgentWebhookService.
 */

import { NextRequest, NextResponse } from 'next/server'
import { aiAgentWebhookService, type TaskAssignmentWebhookPayload } from '@/lib/ai-agent-webhook-service'
import { RATE_LIMITS, withRateLimit } from '@/lib/rate-limiter'
import { z } from 'zod'
import { detectPortFromRequest } from '@/lib/runtime-port-detection'

// Force dynamic rendering for webhook endpoints
export const dynamic = 'force-dynamic'

// Validation schema for incoming task assignment webhook payloads
const TaskAssignmentSchema = z.object({
  event: z.enum(['task.assigned', 'task.updated', 'task.completed', 'task.commented']),
  timestamp: z.string(),
  aiAgent: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    email: z.string()
  }),
  task: z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    priority: z.number(),
    dueDateTime: z.string().optional(),
    assigneeId: z.string(),
    creatorId: z.string(),
    listId: z.string(),
    url: z.string()
  }),
  list: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    githubRepositoryId: z.string().optional()
  }),
  mcp: z.object({
    baseUrl: z.string(),
    operationsEndpoint: z.string(),
    accessToken: z.string().optional(),
    availableOperations: z.array(z.string()),
    contextInstructions: z.string()
  }),
  creator: z.object({
    id: z.string(),
    name: z.string().optional(),
    email: z.string()
  }),
  comment: z.object({
    id: z.string(),
    content: z.string(),
    authorName: z.string(),
    authorId: z.string(),
    createdAt: z.string()
  }).optional()
})

/**
 * AI Agent Webhook - POST Handler
 */
export async function POST(request: NextRequest) {
  // Detect current port from request for dynamic URL generation
  const detectedPort = detectPortFromRequest(request)
  if (detectedPort) {
    console.log(`[Port Detection] Detected server running on port ${detectedPort}`)
  }

  // Apply rate limiting
  const rateLimitCheck = withRateLimit(RATE_LIMITS.WEBHOOK)(request)
  if (!rateLimitCheck.allowed) {
    console.log('[AI Agent] Webhook rate limited:', rateLimitCheck.error)
    return NextResponse.json(
      rateLimitCheck.error,
      {
        status: 429,
        headers: rateLimitCheck.headers
      }
    )
  }

  try {
    console.log('[AI Agent] Received task assignment notification')

    // Parse and validate request body
    const body = await request.json()
    const payload: TaskAssignmentWebhookPayload = TaskAssignmentSchema.parse(body)

    console.log(`[AI Agent] Event: ${payload.event}`)
    console.log(`[AI Agent] Task: "${payload.task.title}"`)
    console.log(`[AI Agent] Agent: ${payload.aiAgent.name} (${payload.aiAgent.type})`)

    // Delegate to webhook service
    await aiAgentWebhookService.notifyTaskAssignment(
      payload.task.id,
      payload.aiAgent.id,
      payload.event === 'task.completed' ? 'task.updated' : payload.event as 'task.assigned' | 'task.updated'
    )

    return NextResponse.json({
      success: true,
      message: `Webhook processed for ${payload.event}`,
      taskId: payload.task.id,
      aiAgent: payload.aiAgent.name,
      event: payload.event,
      timestamp: new Date().toISOString()
    }, { status: 200 })

  } catch (error) {
    if (error instanceof z.ZodError) {
      console.log('[AI Agent] Invalid payload:', error.errors)
      return NextResponse.json({
        error: 'Invalid payload format',
        details: error.errors
      }, { status: 400 })
    }

    console.error('[AI Agent] Error processing webhook:', error)
    return NextResponse.json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ?
        (error instanceof Error ? error.message : String(error)) : undefined
    }, { status: 500 })
  }
}

/**
 * GET endpoint for webhook documentation
 */
export async function GET() {
  return NextResponse.json({
    service: 'AI Agent Webhook',
    description: 'Receives task assignments and delegates to AIAgentWebhookService',
    version: '4.0.0',
    endpoint: 'https://astrid.cc/api/ai-agent/webhook',
    method: 'POST',
    supportedEvents: [
      'task.assigned',
      'task.updated',
      'task.completed',
      'task.commented'
    ],
    usage: 'Configure AI agent webhookUrl to: https://astrid.cc/api/ai-agent/webhook'
  })
}
