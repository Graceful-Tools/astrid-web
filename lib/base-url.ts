/**
 * Base URL utilities for environment-aware URL generation
 * Automatically detects the correct base URL based on environment variables and dynamic port detection
 */

import { getDevBaseUrl, isLocalDevelopment } from './port-detection'
import { BRAND, brandOrigin } from '@/lib/brand/config'
import { createLogger } from '@/lib/logger'
import { createUnsubscribeToken } from '@/lib/unsubscribe-token'

const log = createLogger('base-url')


/**
 * Get the base URL for the current environment
 * Prioritizes NEXTAUTH_URL, then NEXT_PUBLIC_BASE_URL, then Vercel URL, then dynamic localhost detection
 *
 * IMPORTANT: In production, this will NEVER return an insecure http:// URL to prevent
 * mixed content warnings when the app is served over HTTPS
 */
/**
 * Strip trailing slashes so `${getBaseUrl()}${path}` cannot produce a double slash.
 *
 * NEXTAUTH_URL is commonly written with a trailing slash — production has it as
 * `https://www.astrid.cc/` — and every consumer concatenates a leading-slash path onto
 * it. That shipped `https://www.astrid.cc//docs/endpoints` in /llms.txt and the plugin
 * manifest: still resolvable, but wrong in a document whose whole job is telling an
 * agent where to go. Found on a live preview deploy; local dev sets no trailing slash,
 * which is why it never showed up. Task 97208a72.
 */
function normalize(url: string): string {
  return url.replace(/\/+$/, '')
}

export function getBaseUrl(): string {
  // Server-side: prioritize NEXTAUTH_URL (most reliable for production)
  if (typeof window === 'undefined') {
    // Check for explicit environment variables first
    if (process.env.NEXTAUTH_URL) {
      return normalize(process.env.NEXTAUTH_URL)
    }

    if (process.env.NEXT_PUBLIC_BASE_URL) {
      return normalize(process.env.NEXT_PUBLIC_BASE_URL)
    }

    // Vercel deployment
    if (process.env.VERCEL_URL) {
      return `https://${process.env.VERCEL_URL}`
    }

    // Development: use dynamic port detection instead of hardcoded port
    if (isLocalDevelopment()) {
      return getDevBaseUrl()
    }

    // Final fallback - ensure HTTPS in production to prevent insecure connection warnings
    const fallbackUrl = process.env.NODE_ENV === 'production'
      ? brandOrigin() // Safe production fallback
      : 'http://localhost:3000'

    if (process.env.NODE_ENV === 'production') {
      log.warn(
        '⚠️  BASE URL WARNING: No environment variables set for production deployment.\n' +
        'Please set NEXTAUTH_URL or NEXT_PUBLIC_BASE_URL to avoid incorrect URLs.\n' +
        `Falling back to: ${fallbackUrl}`
      )
    }

    return fallbackUrl
  }

  // Client-side: use window.location (always accurate)
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.host}`
  }

  // Fallback for edge cases - ensure HTTPS in production
  const edgeFallback = process.env.NODE_ENV === 'production'
    ? brandOrigin()
    : 'http://localhost:3000'

  return normalize(process.env.NEXT_PUBLIC_BASE_URL || edgeFallback)
}

/**
 * Get the webhook URL for AI agents
 */
export function getAIAgentWebhookUrl(): string {
  return `${getBaseUrl()}/api/ai-agent/webhook`
}

/**
 * Get a task URL
 */
export function getTaskUrl(taskId: string): string {
  return `${getBaseUrl()}/tasks/${taskId}`
}

/**
 * Build a task URL with list context (for emails and sharing)
 * Priority order: 1) shortcode, 2) list URL with task param, 3) fallback to task URL
 */
export function buildTaskUrlWithContext(
  taskId: string,
  listId?: string,
  shortcode?: string
): string {
  const baseUrl = getBaseUrl()

  // Priority 1: Use shortcode if available
  if (shortcode) {
    return `${baseUrl}/s/${shortcode}`
  }

  // Priority 2: Use list URL with task parameter if listId available
  if (listId) {
    return `${baseUrl}/lists/${listId}?task=${taskId}`
  }

  // Priority 3: Fallback to task URL
  return `${baseUrl}/tasks/${taskId}`
}

/**
 * Get an MCP operations URL
 */
export function getMCPOperationsUrl(): string {
  return `${getBaseUrl()}/api/mcp/operations`
}

/**
 * Get an unsubscribe URL for email reminders.
 *
 * Carries a signed token: the endpoint cannot require a session (the link is
 * clicked from an email, often in another browser), so the link itself has to
 * prove we issued it. Without that, knowing a user id was enough to switch off
 * someone else's reminders. (Task e0613ae5.)
 */
export function getUnsubscribeUrl(userId: string): string {
  const token = createUnsubscribeToken(userId)
  return `${getBaseUrl()}/api/settings/reminders/unsubscribe?userId=${encodeURIComponent(userId)}&token=${token}`
}

/**
 * Check if we're in production environment
 */
export function isProduction(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return true
  }

  const envCandidates = [
    process.env.NEXTAUTH_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ].filter(Boolean) as string[]

  const isProdHost = (url: string) => url.includes(BRAND.domain) || url.includes('vercel.app')

  if (envCandidates.some(isProdHost)) {
    return true
  }

  return isProdHost(getBaseUrl())
}

/**
 * Check if we're in development environment
 */
export function isDevelopment(): boolean {
  return !isProduction()
}
