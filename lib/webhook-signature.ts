/**
 * Webhook Signature Utilities
 *
 * HMAC-SHA256 signature generation and verification for secure webhook communication
 * between Astrid and Claude Code Remote servers.
 *
 * Signature format follows industry standard (similar to GitHub, Stripe):
 * - Timestamp included to prevent replay attacks
 * - Signed payload: `${timestamp}.${body}`
 * - Header format: `sha256=${signature}`
 */

import { BRAND } from '@/lib/brand/config'
import { WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TIMESTAMP_HEADER, WEBHOOK_EVENT_HEADER } from './webhooks/protocol-headers'
import crypto from 'crypto'

/**
 * Generate HMAC-SHA256 signature for a webhook payload
 *
 * @param payload - The JSON string payload to sign
 * @param secret - The webhook secret (shared between Astrid and remote server)
 * @param timestamp - Unix timestamp (ms) as string
 * @returns Hex-encoded HMAC signature
 */
export function generateWebhookSignature(
  payload: string,
  secret: string,
  timestamp: string
): string {
  const signedPayload = `${timestamp}.${payload}`
  return crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex')
}

/**
 * Generate all headers needed for a signed webhook request
 *
 * @param payload - The JSON string payload
 * @param secret - The webhook secret
 * @param event - The event type (e.g., 'task.assigned')
 * @returns Headers object ready for fetch()
 */
export function generateWebhookHeaders(
  payload: string,
  secret: string,
  event: string = 'task.assigned'
): Record<string, string> {
  const timestamp = Date.now().toString()
  const signature = generateWebhookSignature(payload, secret, timestamp)

  return {
    'Content-Type': 'application/json',
    [WEBHOOK_SIGNATURE_HEADER]: `sha256=${signature}`,
    [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
    [WEBHOOK_EVENT_HEADER]: event,
    'User-Agent': `${BRAND.appName}-Webhooks/1.0`,
  }
}

/**
 * Verification result with error details
 */
export interface WebhookVerificationResult {
  valid: boolean
  error?: string
}

/**
 * Verify a webhook signature from an incoming request
 *
 * @param payload - The raw request body as string
 * @param signature - The X-Astrid-Signature header value
 * @param secret - The webhook secret
 * @param timestamp - The X-Astrid-Timestamp header value
 * @param maxAge - Maximum age of timestamp in ms (default: 5 minutes)
 * @returns Verification result with error details if invalid
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
  timestamp: string,
  maxAge: number = 300000 // 5 minutes
): WebhookVerificationResult {
  // Validate inputs
  if (!payload || !signature || !secret || !timestamp) {
    return { valid: false, error: 'Missing required parameters' }
  }

  // Check timestamp freshness (prevent replay attacks)
  const now = Date.now()
  const ts = parseInt(timestamp, 10)

  if (isNaN(ts)) {
    return { valid: false, error: 'Invalid timestamp format' }
  }

  if (now - ts > maxAge) {
    return { valid: false, error: 'Timestamp expired' }
  }

  // Also reject timestamps too far in the future (clock skew protection)
  if (ts - now > 60000) {
    // 1 minute tolerance
    return { valid: false, error: 'Timestamp too far in future' }
  }

  // Generate expected signature
  const expected = generateWebhookSignature(payload, secret, timestamp)

  // Extract actual signature (remove "sha256=" prefix if present)
  const actual = signature.replace(/^sha256=/, '')

  // Timing-safe comparison to prevent timing attacks
  try {
    const expectedBuffer = Buffer.from(expected, 'hex')
    const actualBuffer = Buffer.from(actual, 'hex')

    // Buffers must be same length for timingSafeEqual
    if (expectedBuffer.length !== actualBuffer.length) {
      return { valid: false, error: 'Signature length mismatch' }
    }

    const valid = crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    return { valid }
  } catch {
    return { valid: false, error: 'Signature mismatch' }
  }
}

/**
 * Extract verification headers from a request
 *
 * @param headers - Headers object or function to get headers
 * @returns Object with signature and timestamp, or null if missing
 */
export function extractWebhookHeaders(
  headers: Headers | { get: (name: string) => string | null }
): { signature: string; timestamp: string; event: string } | null {
  const signature = headers.get('x-astrid-signature')
  const timestamp = headers.get('x-astrid-timestamp')
  const event = headers.get('x-astrid-event') || 'unknown'

  if (!signature || !timestamp) {
    return null
  }

  return { signature, timestamp, event }
}
