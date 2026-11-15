/**
 * The one writer of RuntimeBindingAuditEvent rows (AWTD-1668).
 *
 * RFC docs/architecture/BUSINESS_RUNTIME_BINDING_RFC.md §7: audit rows are
 * append-only and "never record tokens, headers, webhook secrets, raw prompts,
 * endpoint credentials or payment information". Callers pass field NAMES and
 * scope summaries; this helper also strips any secret- or prompt-shaped key from
 * `details` at any depth, as a backstop for a careless caller.
 *
 * It writes through the client it is given, so a configuration change and its
 * audit event commit in one transaction ("Configuration changes and approvals
 * must commit with their audit event").
 *
 * Retention and export live in lib/runtime-binding/audit-retention.ts (AWTD-1670).
 */

import type { Prisma } from '@prisma/client'
import type { KnownRuntimeBindingAuditEventType } from '@/lib/runtime-binding/audit-retention'

/**
 * Only types classified for retention (lib/runtime-binding/audit-retention.ts,
 * AWTD-1670) can be written, so a new type cannot skip that decision.
 */
export type RuntimeBindingAuditEventType = KnownRuntimeBindingAuditEventType

export interface RuntimeBindingAuditInput {
  bindingId: string | null
  bindingRevision?: number | null
  eventType: RuntimeBindingAuditEventType
  actorUserId?: string | null
  actorPrincipal?: string | null
  boardIds?: string[]
  repositoryRefs?: string[]
  reasonCode?: string | null
  details?: Record<string, unknown> | null
  correlationId?: string | null
}

type AuditClient = { runtimeBindingAuditEvent: Pick<Prisma.TransactionClient['runtimeBindingAuditEvent'], 'create'> }

/**
 * Keys whose VALUE must never be stored. Reference fields are opaque ids, but
 * the audit trail records only that they changed (by field name), not what to.
 */
const FORBIDDEN_KEY =
  /token|secret|password|passwd|credential|endpoint|billingaccount|apikey|api_key|prompt|header|authorization|cookie|signature|privatekey|private_key/i

export function sanitizeAuditDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuditDetails)
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY.test(key)) continue
      out[key] = sanitizeAuditDetails(inner)
    }
    return out
  }
  return value
}

export async function recordRuntimeBindingAudit(client: AuditClient, event: RuntimeBindingAuditInput) {
  const details = event.details ? (sanitizeAuditDetails(event.details) as Prisma.InputJsonValue) : undefined
  return client.runtimeBindingAuditEvent.create({
    data: {
      bindingId: event.bindingId,
      bindingRevision: event.bindingRevision ?? null,
      eventType: event.eventType,
      actorUserId: event.actorUserId ?? null,
      actorPrincipal: event.actorPrincipal ?? null,
      boardIds: event.boardIds ?? [],
      repositoryRefs: event.repositoryRefs ?? [],
      reasonCode: event.reasonCode ?? null,
      details,
      correlationId: event.correlationId ?? null,
    },
  })
}
