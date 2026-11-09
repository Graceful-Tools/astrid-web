import type { PrismaClient } from '@prisma/client'
import { agentMailboxFromEmail } from '@/lib/brand/agent-emails'
import { z } from 'zod'

export type WebhookDeliveryPolicy = 'fallback' | 'strict'

const settingsSchema = z.object({
  webhookDeliveryPolicy: z.enum(['fallback', 'strict']).optional(),
  agentWebhookDeliveryPolicies: z.record(z.string(), z.enum(['fallback', 'strict'])).optional(),
}).passthrough()

export function parseWebhookDeliverySettings(raw: string | null | undefined) {
  return settingsSchema.parse(raw ? JSON.parse(raw) : {})
}

export interface WebhookDeliveryResult {
  sent: boolean
  error?: string
  /** Safe, bounded explanation for task comments; error retains the legacy diagnostic. */
  reason?: string
  status?: number
  /** A 2xx only confirms receipt; it is not proof of execution. */
  accepted?: boolean
  /** null means the endpoint provided no execution acknowledgement. */
  started?: boolean | null
  transport?: 'user-webhook' | 'env-webhook'
  fallbackReason?: string
}

export function isWebhookDeliveryPolicy(value: unknown): value is WebhookDeliveryPolicy {
  return value === 'fallback' || value === 'strict'
}

export function resolveWebhookDeliveryPolicy(
  settings: Record<string, unknown>,
  mailbox?: string | null,
): WebhookDeliveryPolicy {
  const bindings = settings.agentWebhookDeliveryPolicies
  const binding = mailbox && bindings && typeof bindings === 'object' && !Array.isArray(bindings)
    ? (bindings as Record<string, unknown>)[mailbox]
    : undefined
  const value = binding ?? settings.webhookDeliveryPolicy
  if (value === undefined) return 'fallback'
  if (!isWebhookDeliveryPolicy(value)) {
    throw new Error('Invalid webhook delivery policy')
  }
  return value
}

export async function readWebhookDeliveryPolicy(
  prisma: PrismaClient,
  userId: string | null | undefined,
  mailbox?: string | null,
): Promise<WebhookDeliveryPolicy> {
  if (!userId) return 'fallback'
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mcpSettings: true },
  })
  return resolveWebhookDeliveryPolicy(parseWebhookDeliverySettings(user?.mcpSettings), mailbox)
}

export function deliveryMailbox(email: string | null | undefined, agentType: string | null): string | null {
  return agentMailboxFromEmail(email) ?? agentType
}
