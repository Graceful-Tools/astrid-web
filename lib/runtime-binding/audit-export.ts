/**
 * The controlled export of one runtime binding's audit trail (AWTD-1670).
 *
 * RFC §7 (docs/architecture/BUSINESS_RUNTIME_BINDING_RFC.md): "Audit reads
 * require a scoped administrative permission and have an explicit
 * retention/export policy." Authorization is the route's job
 * (app/api/v1/runtime-bindings/[id]/audit-export); this module is what an
 * authorized export does:
 *
 *  1. AUDIT FIRST. An `audit-exported` lifecycle event is written before a
 *     single row is read. If it cannot be written the export throws and nothing
 *     leaves: an unaudited read of the trail is exactly what this is for.
 *  2. EXPLICIT COLUMNS. Rows are selected column by column, and the binding
 *     summary carries no endpoint, credential or payer reference.
 *  3. A SECRET BACKSTOP. The schema forbids secrets in `details`, but a writer
 *     can still get that wrong; keys that name a secret are redacted on the way
 *     out. References (`…Ref`), ids and generations stay: the RFC audits a
 *     credential's identity and generation, never its value.
 */

import { prisma as defaultPrisma } from '@/lib/prisma'
import { runtimeBindingAuditRetentionEnv } from '@/lib/env'
import { toCsv } from '@/lib/csv'
import { auditEventClass, auditRetentionPolicy, type AuditRetentionClass, type AuditRetentionPolicy } from './audit-retention'

export const RUNTIME_BINDING_AUDIT_EXPORT_FORMATS = ['json', 'csv'] as const
export type RuntimeBindingAuditExportFormat = (typeof RUNTIME_BINDING_AUDIT_EXPORT_FORMATS)[number]

export function isAuditExportFormat(value: string): value is RuntimeBindingAuditExportFormat {
  return (RUNTIME_BINDING_AUDIT_EXPORT_FORMATS as readonly string[]).includes(value)
}

/**
 * Rows per export. Ninety days of operational events on a busy binding could be
 * large; past this the export says `truncated` rather than holding a function
 * open until it times out.
 */
export const RUNTIME_BINDING_AUDIT_EXPORT_MAX_ROWS = 50_000

const EVENT_SELECT = {
  id: true,
  createdAt: true,
  eventType: true,
  bindingId: true,
  bindingRevision: true,
  actorUserId: true,
  actorPrincipal: true,
  boardIds: true,
  repositoryRefs: true,
  reasonCode: true,
  correlationId: true,
  runId: true,
  transportOutcome: true,
  details: true,
} as const

/** CSV column order; JSON uses the same names. */
export const AUDIT_EXPORT_COLUMNS = [
  'id', 'createdAt', 'eventType', 'retentionClass', 'bindingId', 'bindingRevision',
  'actorUserId', 'actorPrincipal', 'boardIds', 'repositoryRefs', 'reasonCode',
  'correlationId', 'runId', 'transportOutcome', 'details',
] as const

// ── The secret backstop ────────────────────────────────────────────────────

const SECRET_KEY = /(secret|token|password|passwd|authorization|cookie|api[-_]?key|private[-_]?key|signature|bearer)/i
const OPAQUE_KEY = /(Ref|Refs|Id|Ids|Generation|Count)$/

export const REDACTED = '[redacted]'

/** A copy of `details` with any secret-named key's value replaced. */
export function redactAuditDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditDetails)
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [
        key,
        SECRET_KEY.test(key) && !OPAQUE_KEY.test(key) ? REDACTED : redactAuditDetails(v),
      ]),
    )
  }
  return value
}

// ── The export ─────────────────────────────────────────────────────────────

interface ExportClient {
  runtimeBinding: {
    findUnique(args: unknown): Promise<{
      id: string
      state: string
      revision: number
      createdAt: Date
      revokedAt: Date | null
    } | null>
  }
  runtimeBindingAuditEvent: {
    create(args: unknown): Promise<{ id: string }>
    findMany(args: unknown): Promise<Array<Record<string, unknown> & { eventType: string }>>
  }
}

export interface AuditExportEvent extends Record<string, unknown> {
  id: string
  eventType: string
  retentionClass: AuditRetentionClass
}

export interface RuntimeBindingAuditExport {
  binding: { id: string; state: string; revision: number; createdAt: Date; revokedAt: Date | null }
  retention: AuditRetentionPolicy
  exportedAt: Date
  exportedBy: string
  /** The `audit-exported` event this export wrote; it is in `events` too. */
  exportEventId: string
  truncated: boolean
  events: AuditExportEvent[]
}

export type AuditExportResult = { status: 'not-found' } | { status: 'ok'; export: RuntimeBindingAuditExport }

export async function exportRuntimeBindingAuditTrail(
  {
    bindingId,
    actorUserId,
    format,
    now = new Date(),
  }: { bindingId: string; actorUserId: string; format: RuntimeBindingAuditExportFormat; now?: Date },
  client: ExportClient = defaultPrisma as unknown as ExportClient,
): Promise<AuditExportResult> {
  const binding = await client.runtimeBinding.findUnique({
    where: { id: bindingId },
    select: { id: true, state: true, revision: true, createdAt: true, revokedAt: true },
  })
  if (!binding) return { status: 'not-found' }

  // 1. Audit first: if this throws, nothing below runs.
  const exportEvent = await client.runtimeBindingAuditEvent.create({
    data: {
      bindingId: binding.id,
      bindingRevision: binding.revision,
      eventType: 'audit-exported',
      actorUserId,
      boardIds: [],
      repositoryRefs: [],
      details: { format, maxRows: RUNTIME_BINDING_AUDIT_EXPORT_MAX_ROWS },
    },
    select: { id: true },
  })

  // 2. Then read, oldest first, one past the cap to know whether it was hit.
  const rows = await client.runtimeBindingAuditEvent.findMany({
    where: { bindingId: binding.id },
    select: EVENT_SELECT,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: RUNTIME_BINDING_AUDIT_EXPORT_MAX_ROWS + 1,
  })
  const truncated = rows.length > RUNTIME_BINDING_AUDIT_EXPORT_MAX_ROWS

  const events = rows.slice(0, RUNTIME_BINDING_AUDIT_EXPORT_MAX_ROWS).map(row => ({
    ...row,
    id: String(row.id),
    retentionClass: auditEventClass(row.eventType),
    details: redactAuditDetails(row.details ?? null),
  }))

  return {
    status: 'ok',
    export: {
      binding,
      retention: auditRetentionPolicy(runtimeBindingAuditRetentionEnv()),
      exportedAt: now,
      exportedBy: actorUserId,
      exportEventId: exportEvent.id,
      truncated,
      events,
    },
  }
}

/** The CSV rendering: one row per event, arrays joined with `;`, details as JSON. */
export function auditExportToCsv(data: RuntimeBindingAuditExport): string {
  const rows = data.events.map(event => ({
    ...event,
    boardIds: Array.isArray(event.boardIds) ? event.boardIds.join(';') : event.boardIds,
    repositoryRefs: Array.isArray(event.repositoryRefs) ? event.repositoryRefs.join(';') : event.repositoryRefs,
    details: event.details === null || event.details === undefined ? '' : JSON.stringify(event.details),
  }))
  // Actor principals, reason codes and details are written by agents and
  // runtimes: neutralise anything a spreadsheet would execute.
  return toCsv(AUDIT_EXPORT_COLUMNS, rows, { neutralizeFormulas: true })
}
