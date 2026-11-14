/**
 * Webhook delivery policy (AWTD-1561): may a failed or missing user webhook
 * cross into Astrid's own fallback (the environment webhook, the assistant or
 * tools workflow)?
 *
 * - `fallback` (default, and what malformed settings read as): today's routing,
 *   unchanged. The owner hears about it only when a webhook THEY configured was
 *   actually tried and failed — one notice per dispatch (Jon, 2026-11-13).
 * - `strict` (opt-in): no fallback. The task is parked and the owner told.
 *
 * Stored in `User.mcpSettings` beside the agent modes; no migration.
 */
import type { PrismaClient } from '@prisma/client'
import { agentMailboxFromEmail } from '@/lib/brand/agent-emails'
import { MCPSettingsSchema, parseUserAIConfig } from '@/lib/ai/user-config-schemas'
import { createLogger } from '@/lib/logger'

const log = createLogger('webhooks/delivery-policy')

export type WebhookDeliveryPolicy = 'fallback' | 'strict'

export interface WebhookDeliveryResult {
  sent: boolean
  error?: string
  /** Safe, bounded explanation for task comments; `error` keeps the legacy diagnostic. */
  reason?: string
  status?: number
  /** The user's webhook is healthy but deliberately not subscribed to this event. */
  unsubscribed?: boolean
  /** True only when the user's OWN configured webhook was actually POSTed to. */
  attempted?: boolean
  /** A 2xx only confirms receipt; it is not proof of execution. */
  accepted?: boolean
  /** null: the endpoint protocol carries no execution acknowledgement. */
  started?: boolean | null
  transport?: 'user-webhook' | 'env-webhook'
}

export function isWebhookDeliveryPolicy(value: unknown): value is WebhookDeliveryPolicy {
  return value === 'fallback' || value === 'strict'
}

/** Tolerant: anything unreadable is the default, exactly as dispatch behaved before the policy existed. */
export function parseWebhookDeliverySettings(raw: string | null | undefined, onInvalid?: () => never) {
  return parseUserAIConfig(raw, MCPSettingsSchema, 'webhook-delivery-policy', onInvalid) as Record<string, unknown>
}

export function agentPolicyBindings(settings: Record<string, unknown>): Record<string, WebhookDeliveryPolicy> {
  const raw = settings.agentWebhookDeliveryPolicies
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter((entry): entry is [string, WebhookDeliveryPolicy] =>
      isWebhookDeliveryPolicy(entry[1])),
  )
}

/** A mailbox binding beats the account default; an unrecognised value is ignored (→ fallback). */
export function resolveWebhookDeliveryPolicy(
  settings: Record<string, unknown>,
  mailbox?: string | null,
): WebhookDeliveryPolicy {
  const binding = mailbox ? agentPolicyBindings(settings)[mailbox] : undefined
  if (binding) return binding
  return isWebhookDeliveryPolicy(settings.webhookDeliveryPolicy) ? settings.webhookDeliveryPolicy : 'fallback'
}

export async function readWebhookDeliveryPolicy(
  prisma: PrismaClient,
  userId: string | null | undefined,
  mailbox?: string | null,
): Promise<WebhookDeliveryPolicy> {
  if (!userId) return 'fallback'
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { mcpSettings: true } })
    return resolveWebhookDeliveryPolicy(parseWebhookDeliverySettings(user?.mcpSettings), mailbox)
  } catch (err) {
    // A read that fails must not stop dispatch: main never read this at all.
    log.warn({ err, userId }, 'could not read webhook delivery policy; using fallback')
    return 'fallback'
  }
}

export function deliveryMailbox(email: string | null | undefined, agentType: string | null): string | null {
  return agentMailboxFromEmail(email) ?? agentType
}

/** The user's own webhook was tried and did not take the delivery: the one case fallback mode reports. */
export function userWebhookFailed(result: WebhookDeliveryResult): boolean {
  return Boolean(result.attempted) && !result.sent && !result.accepted
}

/**
 * A reason safe to show in a task comment. Transport errors can carry
 * secrets, so only the sender's bounded `reason` or its fixed pre-flight
 * messages are used, never a raw exception.
 */
export function deliveryFailureReason(result: WebhookDeliveryResult): string {
  if (result.reason) return result.reason
  if (!result.attempted && result.error && !result.transport && result.error !== 'No webhook configured') return result.error
  return 'no webhook is configured'
}

/**
 * Marks a delivery notice so the agent's own conversation history leaves it out
 * (lib/assistant-workflow buildPrompt). It is also system-generated, so it never
 * wakes an agent (lib/comments/post-comment-side-effects.ts).
 */
export const WEBHOOK_DELIVERY_NOTICE_MARKER = '<!-- WEBHOOK_DELIVERY_NOTICE -->'

export function isWebhookDeliveryNotice(content: string | null | undefined): boolean {
  return Boolean(content?.includes(WEBHOOK_DELIVERY_NOTICE_MARKER))
}
