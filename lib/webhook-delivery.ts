/**
 * Webhook Delivery Service
 *
 * Provides reliable webhook delivery with:
 * - Exponential backoff retry (1s, 2s, 4s)
 * - Delivery logging and status tracking
 * - Configurable retry limits
 */

import { WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TIMESTAMP_HEADER, WEBHOOK_EVENT_HEADER } from './webhooks/protocol-headers'
import { BRAND } from '@/lib/brand/config'
import { prisma } from '@/lib/prisma'
import { decryptField } from "@/lib/field-encryption"
import { generateWebhookSignature } from './webhook-signature'
import { createLogger } from '@/lib/logger'

const log = createLogger('webhook-delivery')


// ============================================================================
// TYPES
// ============================================================================

export interface WebhookDeliveryOptions {
  /** User ID who owns the webhook config */
  userId: string
  /** Task ID being processed */
  taskId: string
  /** Event type being delivered */
  event: string
  /** Webhook URL to deliver to */
  url: string
  /** Webhook secret for signing */
  secret: string
  /** Payload to deliver */
  payload: Record<string, unknown>
  /** Max retries (default: 3) */
  maxRetries?: number
  /** Initial backoff in ms (default: 1000) */
  initialBackoffMs?: number
  /** Request timeout in ms (default: 10000) */
  timeoutMs?: number
}

export interface WebhookDeliveryResult {
  success: boolean
  statusCode?: number
  responseTime?: number
  attempts: number
  error?: string
  deliveryId?: string
}

// ============================================================================
// DELIVERY LOGGING
// ============================================================================

interface DeliveryLogEntry {
  userId: string
  taskId: string
  event: string
  webhookUrl: string
  status: 'pending' | 'success' | 'failed'
  attempts: number
  responseCode?: number | null
  responseTimeMs?: number | null
  errorMessage?: string | null
}

async function createDeliveryLog(entry: DeliveryLogEntry): Promise<string> {
  // Note: This requires the WebhookDeliveryLog model in Prisma schema
  // If not available, fall back to console logging
  try {
    // Try to use Prisma if model exists
    const log = await (prisma as any).webhookDeliveryLog?.create({
      data: {
        userId: entry.userId,
        taskId: entry.taskId,
        event: entry.event,
        webhookUrl: entry.webhookUrl,
        status: entry.status,
        attempts: entry.attempts,
        responseCode: entry.responseCode,
        responseTimeMs: entry.responseTimeMs,
        errorMessage: entry.errorMessage,
      }
    })
    return log?.id || `local-${Date.now()}`
  } catch {
    // Model doesn't exist yet, just log to console
    log.info(`[WebhookDelivery] ${entry.status}: ${entry.event} to ${entry.webhookUrl}`)
    return `local-${Date.now()}`
  }
}

async function updateDeliveryLog(
  id: string,
  update: Partial<DeliveryLogEntry>
): Promise<void> {
  if (id.startsWith('local-')) return

  try {
    await (prisma as any).webhookDeliveryLog?.update({
      where: { id },
      data: update
    })
  } catch {
    // Ignore if model doesn't exist
  }
}

// ============================================================================
// DELIVERY FUNCTION
// ============================================================================

/**
 * Deliver a webhook with retry and logging
 */
export async function deliverWebhook(
  options: WebhookDeliveryOptions
): Promise<WebhookDeliveryResult> {
  const {
    userId,
    taskId,
    event,
    url,
    secret,
    payload,
    maxRetries = 3,
    initialBackoffMs = 1000,
    timeoutMs = 10000
  } = options

  // Create initial log entry
  const deliveryId = await createDeliveryLog({
    userId,
    taskId,
    event,
    webhookUrl: url,
    status: 'pending',
    attempts: 0,
  })

  let lastError: string | undefined
  let lastStatusCode: number | undefined
  let lastResponseTime: number | undefined

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const startTime = Date.now()

    try {
      // Generate signature
      const timestamp = Date.now().toString()
      const payloadString = JSON.stringify(payload)
      const signature = generateWebhookSignature(payloadString, secret, timestamp)

      // Create abort controller for timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      // Make request
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [WEBHOOK_SIGNATURE_HEADER]: `sha256=${signature}`,
          [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
          [WEBHOOK_EVENT_HEADER]: event,
          'User-Agent': `${BRAND.appName}-Webhook/1.0`
        },
        body: payloadString,
        signal: controller.signal
      })

      clearTimeout(timeoutId)
      lastResponseTime = Date.now() - startTime
      lastStatusCode = response.status

      if (response.ok) {
        // Success!
        await updateDeliveryLog(deliveryId, {
          status: 'success',
          attempts: attempt,
          responseCode: response.status,
          responseTimeMs: lastResponseTime,
        })

        log.info(`[WebhookDelivery] Success: ${event} delivered to ${url} (${lastResponseTime}ms)`)

        return {
          success: true,
          statusCode: response.status,
          responseTime: lastResponseTime,
          attempts: attempt,
          deliveryId
        }
      }

      // Non-2xx response
      const errorText = await response.text().catch(() => 'Unknown error')
      lastError = `HTTP ${response.status}: ${errorText.slice(0, 200)}`

      // Don't retry for client errors (4xx) except 429 (rate limit)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        log.warn(`[WebhookDelivery] Client error, not retrying: ${lastError}`)
        break
      }

    } catch (error) {
      lastResponseTime = Date.now() - startTime

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          lastError = `Request timed out after ${timeoutMs}ms`
        } else {
          lastError = error.message
        }
      } else {
        lastError = String(error)
      }
    }

    // Log the failed attempt
    log.warn(`[WebhookDelivery] Attempt ${attempt}/${maxRetries} failed: ${lastError}`)

    // Exponential backoff before retry (unless this was the last attempt)
    if (attempt < maxRetries) {
      const backoffMs = initialBackoffMs * Math.pow(2, attempt - 1)
      log.info(`[WebhookDelivery] Waiting ${backoffMs}ms before retry...`)
      await new Promise(resolve => setTimeout(resolve, backoffMs))
    }
  }

  // All attempts failed
  await updateDeliveryLog(deliveryId, {
    status: 'failed',
    attempts: maxRetries,
    responseCode: lastStatusCode,
    responseTimeMs: lastResponseTime,
    errorMessage: lastError,
  })

  log.error(`[WebhookDelivery] Failed after ${maxRetries} attempts: ${lastError}`)

  return {
    success: false,
    statusCode: lastStatusCode,
    responseTime: lastResponseTime,
    attempts: maxRetries,
    error: lastError,
    deliveryId
  }
}

// ============================================================================
// BATCH DELIVERY
// ============================================================================

/**
 * Deliver webhooks to multiple URLs (e.g., user webhook + system webhook)
 */
export async function deliverWebhookToMultiple(
  urls: Array<{ url: string; secret: string; userId?: string }>,
  taskId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<WebhookDeliveryResult[]> {
  const results = await Promise.allSettled(
    urls.map(({ url, secret, userId }) =>
      deliverWebhook({
        userId: userId || 'system',
        taskId,
        event,
        url,
        secret,
        payload
      })
    )
  )

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value
    }
    return {
      success: false,
      attempts: 0,
      error: `Promise rejected: ${result.reason}`
    }
  })
}

// ============================================================================
// DELIVERY LOG QUERIES
// ============================================================================

/**
 * Get recent webhook deliveries for a user
 */
export async function getRecentDeliveries(
  userId: string,
  limit: number = 20
): Promise<Array<{
  id: string
  taskId: string
  event: string
  status: string
  attempts: number
  responseCode: number | null
  responseTimeMs: number | null
  errorMessage: string | null
  createdAt: Date
}>> {
  try {
    const logs = await (prisma as any).webhookDeliveryLog?.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        taskId: true,
        event: true,
        status: true,
        attempts: true,
        responseCode: true,
        responseTimeMs: true,
        errorMessage: true,
        createdAt: true,
      }
    })
    return logs || []
  } catch {
    return []
  }
}

/**
 * Get delivery stats for a user
 */
export async function getDeliveryStats(
  userId: string,
  since: Date = new Date(Date.now() - 24 * 60 * 60 * 1000)
): Promise<{
  total: number
  successful: number
  failed: number
  avgResponseTimeMs: number | null
}> {
  try {
    const [counts, avgTime] = await Promise.all([
      (prisma as any).webhookDeliveryLog?.groupBy({
        by: ['status'],
        where: { userId, createdAt: { gte: since } },
        _count: { status: true }
      }),
      (prisma as any).webhookDeliveryLog?.aggregate({
        where: { userId, status: 'success', createdAt: { gte: since } },
        _avg: { responseTimeMs: true }
      })
    ])

    const stats = { total: 0, successful: 0, failed: 0, avgResponseTimeMs: null as number | null }

    if (counts) {
      for (const row of counts) {
        stats.total += row._count.status
        if (row.status === 'success') stats.successful = row._count.status
        if (row.status === 'failed') stats.failed = row._count.status
      }
    }

    if (avgTime?._avg?.responseTimeMs) {
      stats.avgResponseTimeMs = Math.round(avgTime._avg.responseTimeMs)
    }

    return stats
  } catch {
    return { total: 0, successful: 0, failed: 0, avgResponseTimeMs: null }
  }
}

/**
 * Retry a failed delivery
 */
export async function retryDelivery(
  deliveryId: string,
  newPayload?: Record<string, unknown>
): Promise<WebhookDeliveryResult> {
  try {
    const log = await (prisma as any).webhookDeliveryLog?.findUnique({
      where: { id: deliveryId }
    })

    if (!log) {
      return { success: false, attempts: 0, error: 'Delivery log not found' }
    }

    // Get the user's current webhook config
    const config = await prisma.userWebhookConfig.findUnique({
      where: { userId: log.userId }
    })

    if (!config || !config.webhookUrl || !config.webhookSecret) {
      return { success: false, attempts: 0, error: 'Webhook config not found' }
    }

    // Retry with the original or new payload
    // Note: We don't have the original payload stored, so caller must provide it
    if (!newPayload) {
      return { success: false, attempts: 0, error: 'Payload required for retry' }
    }

    return deliverWebhook({
      userId: log.userId,
      taskId: log.taskId,
      event: log.event,
      url: decryptField(config.webhookUrl) || config.webhookUrl,
      secret: decryptField(config.webhookSecret) || config.webhookSecret,
      payload: newPayload
    })
  } catch (error) {
    return {
      success: false,
      attempts: 0,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
