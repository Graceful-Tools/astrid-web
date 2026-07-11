/**
 * User Webhook Settings API
 *
 * Manages Claude Code Remote server webhook configuration for users.
 * Users can configure their self-hosted server URL and get a webhook secret
 * for secure communication.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { encryptField, decryptField } from '@/lib/field-encryption'
import crypto from 'crypto'
import { createLogger } from '@/lib/logger'

const log = createLogger('user.webhook-settings')


// Available AI agents that can be routed to webhook
const AVAILABLE_AGENTS = ['claude', 'openai', 'gemini'] as const

// Validation schema for webhook settings
const WebhookSettingsSchema = z.object({
  webhookUrl: z.string().url('Must be a valid URL'),
  enabled: z.boolean().optional(),
  events: z.array(z.enum([
    'task.assigned',
    'comment.created',
    'task.updated'
  ])).optional(),
  agents: z.array(z.enum(['claude', 'openai', 'gemini', 'copilot'])).optional(),
  regenerateSecret: z.boolean().optional()
})

// Events that can be subscribed to
const AVAILABLE_EVENTS = [
  'task.assigned',
  'comment.created',
  'task.updated'
] as const

/**
 * GET /api/user/webhook-settings
 *
 * Retrieve current webhook configuration
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const config = await prisma.userWebhookConfig.findUnique({
      where: { userId: session.user.id }
    })

    if (!config) {
      return NextResponse.json({
        configured: false,
        availableEvents: AVAILABLE_EVENTS,
        availableAgents: AVAILABLE_AGENTS
      })
    }

    // Decrypt webhook URL for display (don't expose secret)
    const webhookUrl = decryptField(config.webhookUrl)

    return NextResponse.json({
      configured: true,
      enabled: config.enabled,
      events: config.events,
      agents: config.agents,
      webhookUrl,
      hasSecret: !!config.webhookSecret,
      lastFiredAt: config.lastFiredAt,
      failureCount: config.failureCount,
      maxRetries: config.maxRetries,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
      availableEvents: AVAILABLE_EVENTS,
      availableAgents: AVAILABLE_AGENTS
    })

  } catch (error) {
    log.error({ err: error }, 'Error fetching webhook settings:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/user/webhook-settings
 *
 * Create or update webhook configuration
 * Returns the webhook secret on first creation or when regenerateSecret is true
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validatedData = WebhookSettingsSchema.parse(body)

    // Check if user already has webhook config
    const existingConfig = await prisma.userWebhookConfig.findUnique({
      where: { userId: session.user.id }
    })

    // Generate new secret if creating or regenerating
    const generateSecret = !existingConfig || validatedData.regenerateSecret
    const newSecret = generateSecret
      ? crypto.randomBytes(32).toString('hex')
      : undefined

    // Encrypt the URL and secret
    const encryptedUrl = encryptField(validatedData.webhookUrl)
    const encryptedSecret = newSecret ? encryptField(newSecret) : undefined

    // Build the data object
    const configData = {
      webhookUrl: encryptedUrl,
      enabled: validatedData.enabled ?? true,
      events: validatedData.events ?? ['task.assigned', 'comment.created'],
      agents: validatedData.agents ?? [],
      ...(encryptedSecret && { webhookSecret: encryptedSecret }),
      failureCount: existingConfig ? 0 : undefined // Reset on config change
    }

    // Upsert the config
    const config = await prisma.userWebhookConfig.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        webhookUrl: encryptedUrl,
        webhookSecret: encryptedSecret!,
        enabled: validatedData.enabled ?? true,
        events: validatedData.events ?? ['task.assigned', 'comment.created'],
        agents: validatedData.agents ?? []
      },
      update: {
        ...configData,
        updatedAt: new Date()
      }
    })

    // Build response
    const response: Record<string, unknown> = {
      success: true,
      enabled: config.enabled,
      events: config.events,
      agents: config.agents,
      webhookUrl: validatedData.webhookUrl
    }

    // Only return secret on creation or regeneration
    if (generateSecret && newSecret) {
      response.webhookSecret = newSecret
      response.message = 'Webhook configured successfully. Save this secret - it will not be shown again!'
      response.secretRegenerated = !!existingConfig
    } else {
      response.message = 'Webhook settings updated.'
    }

    return NextResponse.json(response)

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    log.error({ err: error }, 'Error updating webhook settings:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/user/webhook-settings
 *
 * Remove webhook configuration entirely
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if config exists
    const existingConfig = await prisma.userWebhookConfig.findUnique({
      where: { userId: session.user.id }
    })

    if (!existingConfig) {
      return NextResponse.json(
        { error: 'No webhook configuration found' },
        { status: 404 }
      )
    }

    // Delete the config
    await prisma.userWebhookConfig.delete({
      where: { userId: session.user.id }
    })

    return NextResponse.json({
      success: true,
      message: 'Webhook configuration removed.'
    })

  } catch (error) {
    log.error({ err: error }, 'Error deleting webhook settings:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/user/webhook-settings
 *
 * Test the webhook configuration by sending a test event
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const config = await prisma.userWebhookConfig.findUnique({
      where: { userId: session.user.id }
    })

    if (!config) {
      return NextResponse.json(
        { error: 'No webhook configuration found. Configure a webhook first.' },
        { status: 404 }
      )
    }

    if (!config.enabled) {
      return NextResponse.json(
        { error: 'Webhook is disabled. Enable it first.' },
        { status: 400 }
      )
    }

    // Decrypt URL and secret
    const webhookUrl = decryptField(config.webhookUrl)
    const webhookSecret = decryptField(config.webhookSecret)

    if (!webhookUrl || !webhookSecret) {
      return NextResponse.json(
        { error: 'Invalid webhook configuration' },
        { status: 500 }
      )
    }

    // Send test webhook
    const { generateWebhookHeaders } = await import('@/lib/webhook-signature')

    const testPayload = {
      event: 'test.ping',
      timestamp: new Date().toISOString(),
      message: 'This is a test webhook from Astrid',
      user: {
        id: session.user.id,
        email: session.user.email
      }
    }

    const body = JSON.stringify(testPayload)
    const headers = generateWebhookHeaders(body, webhookSecret, 'test.ping')

    const startTime = Date.now()
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10000)
      })

      const responseTime = Date.now() - startTime

      if (!response.ok) {
        return NextResponse.json({
          success: false,
          message: `Server responded with HTTP ${response.status}`,
          responseTime,
          statusCode: response.status
        })
      }

      // Reset failure count on successful test
      await prisma.userWebhookConfig.update({
        where: { id: config.id },
        data: { failureCount: 0 }
      })

      return NextResponse.json({
        success: true,
        message: 'Test webhook sent successfully!',
        responseTime,
        statusCode: response.status
      })

    } catch (fetchError) {
      const responseTime = Date.now() - startTime
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error'

      return NextResponse.json({
        success: false,
        message: `Failed to reach webhook: ${errorMessage}`,
        responseTime,
        error: errorMessage
      })
    }

  } catch (error) {
    log.error({ err: error }, 'Error testing webhook:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
