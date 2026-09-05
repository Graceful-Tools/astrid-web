/**
 * GET/PUT/DELETE/POST /api/v1/users/me/webhook-settings
 *
 * Outbound webhook configuration for the signed-in user. Successor to
 * /api/user/webhook-settings (task 641a7615, decision 3A).
 *
 * **The writes are session-only, on purpose.** v1 normally exists so OAuth
 * tokens can reach a surface; this one is the exception. Setting the URL means
 * "post every task assignment and comment I receive to this address", and the
 * test-fire makes the server issue an outbound request to it. A leaked
 * narrow-scope token that could do either would be a self-service exfiltration
 * channel and an SSRF trigger — the same reasoning that already makes
 * /api/v1/oauth/clients reject non-session callers.
 *
 * GET is not restricted: it returns `hasSecret`, never the secret itself, so
 * there is nothing there worth gating.
 *
 * The secret is shown exactly once — at creation, or when explicitly
 * regenerated. Returning it on every save would spread it through logs and
 * caches for no benefit.
 */

import { NextResponse } from 'next/server'
import { assertOutboundUrlShape, assertPublicOutboundUrl, OutboundUrlError } from '@/lib/security/outbound-url'
import crypto from 'crypto'
import { z } from 'zod'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { encryptField, decryptField } from '@/lib/field-encryption'
import { BRAND } from '@/lib/brand/config'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.users.me.webhook-settings')

const AVAILABLE_EVENTS = ['task.assigned', 'comment.created', 'task.updated'] as const
const AVAILABLE_AGENTS = ['claude', 'openai', 'gemini', 'copilot'] as const

const DEFAULT_EVENTS = ['task.assigned', 'comment.created']

const WebhookSettingsSchema = z.object({
  // Not just "is a URL". This value is fetched by the server on save and on
  // every delivery, so an unchecked one is an internal port scanner and a
  // cloud-metadata probe (task 3794f4ce).
  webhookUrl: z
    .string()
    .url('Must be a valid URL')
    .superRefine((value, ctx) => {
      try {
        assertOutboundUrlShape(value)
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: error instanceof OutboundUrlError ? error.message : 'Invalid URL',
        })
      }
    }),
  enabled: z.boolean().optional(),
  events: z.array(z.enum(AVAILABLE_EVENTS)).optional(),
  agents: z.array(z.enum(AVAILABLE_AGENTS)).optional(),
  regenerateSecret: z.boolean().optional(),
})

const meta = (source: string) => ({ apiVersion: 'v1' as const, authSource: source })

/** Configuring or firing a webhook is an interactive-session capability. See the file header. */
const sessionOnly = NextResponse.json(
  { error: 'Webhook configuration requires an interactive session' },
  { status: 403 }
)

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.users.me.webhook-settings' },
  async (_req, auth) => {
    const config = await prisma.userWebhookConfig.findUnique({
      where: { userId: auth.userId },
    })

    if (!config) {
      // Not a 404: the settings UI builds its event and agent pickers from this
      // response, so an unconfigured user still needs the option lists.
      return NextResponse.json({
        configured: false,
        availableEvents: AVAILABLE_EVENTS,
        availableAgents: AVAILABLE_AGENTS,
        meta: meta(auth.source),
      })
    }

    return NextResponse.json({
      configured: true,
      enabled: config.enabled,
      events: config.events,
      agents: config.agents,
      webhookUrl: decryptField(config.webhookUrl),
      // The secret signs every delivery. Reporting its existence is enough;
      // echoing it would let any reader forge events to the user's server.
      hasSecret: !!config.webhookSecret,
      lastFiredAt: config.lastFiredAt,
      failureCount: config.failureCount,
      maxRetries: config.maxRetries,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
      availableEvents: AVAILABLE_EVENTS,
      availableAgents: AVAILABLE_AGENTS,
      meta: meta(auth.source),
    })
  }
)

export const PUT = withAuth(
  { scopes: ['user:write'], tag: 'v1.users.me.webhook-settings' },
  async (req, auth) => {
    if (auth.source !== 'session') return sessionOnly

    let data: z.infer<typeof WebhookSettingsSchema>
    try {
      data = WebhookSettingsSchema.parse(await req.json().catch(() => ({})))
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid request data', details: error.errors },
          { status: 400 }
        )
      }
      throw error
    }

    const existing = await prisma.userWebhookConfig.findUnique({
      where: { userId: auth.userId },
    })

    const generateSecret = !existing || data.regenerateSecret === true
    const newSecret = generateSecret ? crypto.randomBytes(32).toString('hex') : undefined

    const encryptedUrl = encryptField(data.webhookUrl)
    const encryptedSecret = newSecret ? encryptField(newSecret) : undefined

    const config = await prisma.userWebhookConfig.upsert({
      where: { userId: auth.userId },
      create: {
        userId: auth.userId,
        webhookUrl: encryptedUrl,
        webhookSecret: encryptedSecret!,
        enabled: data.enabled ?? true,
        events: data.events ?? DEFAULT_EVENTS,
        agents: data.agents ?? [],
      },
      update: {
        webhookUrl: encryptedUrl,
        enabled: data.enabled ?? true,
        events: data.events ?? DEFAULT_EVENTS,
        agents: data.agents ?? [],
        ...(encryptedSecret ? { webhookSecret: encryptedSecret } : {}),
        // A config change means the old failures were against the old target.
        failureCount: 0,
        updatedAt: new Date(),
      },
    })

    return NextResponse.json({
      success: true,
      enabled: config.enabled,
      events: config.events,
      agents: config.agents,
      webhookUrl: data.webhookUrl,
      ...(generateSecret && newSecret
        ? {
            webhookSecret: newSecret,
            secretRegenerated: !!existing,
            message: 'Webhook configured successfully. Save this secret - it will not be shown again!',
          }
        : { message: 'Webhook settings updated.' }),
      meta: meta(auth.source),
    })
  }
)

export const DELETE = withAuth(
  { scopes: ['user:write'], tag: 'v1.users.me.webhook-settings' },
  async (_req, auth) => {
    if (auth.source !== 'session') return sessionOnly

    const existing = await prisma.userWebhookConfig.findUnique({
      where: { userId: auth.userId },
    })

    if (!existing) {
      return NextResponse.json({ error: 'No webhook configuration found' }, { status: 404 })
    }

    await prisma.userWebhookConfig.delete({ where: { userId: auth.userId } })

    return NextResponse.json({
      success: true,
      message: 'Webhook configuration removed.',
      meta: meta(auth.source),
    })
  }
)

/** Send a `test.ping` to the configured URL so the user can confirm the wiring. */
export const POST = withAuth(
  { scopes: ['user:write'], tag: 'v1.users.me.webhook-settings' },
  async (_req, auth) => {
    if (auth.source !== 'session') return sessionOnly

    const config = await prisma.userWebhookConfig.findUnique({
      where: { userId: auth.userId },
    })

    if (!config) {
      return NextResponse.json(
        { error: 'No webhook configuration found. Configure a webhook first.' },
        { status: 404 }
      )
    }

    if (!config.enabled) {
      return NextResponse.json({ error: 'Webhook is disabled. Enable it first.' }, { status: 400 })
    }

    const webhookUrl = decryptField(config.webhookUrl)
    const webhookSecret = decryptField(config.webhookSecret)

    if (!webhookUrl || !webhookSecret) {
      return NextResponse.json({ error: 'Invalid webhook configuration' }, { status: 500 })
    }

    // Re-check the stored URL before the test ping: save-time validation cannot
    // cover a name whose DNS changed since, and this handler returns the status
    // code and response time to the caller (task 3794f4ce).
    try {
      await assertPublicOutboundUrl(webhookUrl)
    } catch (error) {
      return NextResponse.json({
        success: false,
        message:
          error instanceof OutboundUrlError
            ? error.message
            : 'Webhook URL is no longer reachable safely',
      })
    }

    const { generateWebhookHeaders } = await import('@/lib/webhook-signature')

    const body = JSON.stringify({
      event: 'test.ping',
      timestamp: new Date().toISOString(),
      message: `This is a test webhook from ${BRAND.appName}`,
      user: { id: auth.userId, email: auth.user.email },
    })

    const startTime = Date.now()
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: generateWebhookHeaders(body, webhookSecret, 'test.ping'),
        body,
        signal: AbortSignal.timeout(10000),
      })
      const responseTime = Date.now() - startTime

      if (!response.ok) {
        // A reachable server that answers 500 is a delivery result, not an API
        // error — the caller asked "does this work", and the answer is no.
        return NextResponse.json({
          success: false,
          message: `Server responded with HTTP ${response.status}`,
          responseTime,
          statusCode: response.status,
          meta: meta(auth.source),
        })
      }

      await prisma.userWebhookConfig.update({
        where: { id: config.id },
        data: { failureCount: 0 },
      })

      return NextResponse.json({
        success: true,
        message: 'Test webhook sent successfully!',
        responseTime,
        statusCode: response.status,
        meta: meta(auth.source),
      })
    } catch (fetchError) {
      const responseTime = Date.now() - startTime
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error'
      log.warn({ err: fetchError }, 'Test webhook could not be delivered')

      return NextResponse.json({
        success: false,
        message: `Failed to reach webhook: ${errorMessage}`,
        responseTime,
        error: errorMessage,
        meta: meta(auth.source),
      })
    }
  }
)
