/**
 * How long RuntimeBindingAuditEvent rows are kept (AWTD-1670).
 *
 * Jon's decision 5 (2026-11-14), docs/architecture/BUSINESS_RUNTIME_BINDING_RFC.md §7:
 *
 *  - OPERATIONAL events (resolution denials, transport attempts, lease
 *    renewals: the detailed diagnostic stream) are kept for NINETY DAYS.
 *  - LIFECYCLE events (consent, approval, revocation and run attribution, and
 *    exports of the trail) are kept for the BINDING'S LIFECYCLE PLUS NINETY
 *    DAYS: until the binding has been revoked for more than ninety days. Subject
 *    to deployment policy and legal review, hence the override below.
 *
 * Pure: no database. The Prisma half is ./audit-retention-service.ts and the
 * nightly caller is /api/cron/binding-audit.
 *
 * UNKNOWN MEANS LIFECYCLE. A type missing from the map below is kept on the long
 * side: wrongly keeping an operational event costs storage, wrongly deleting a
 * consent record cannot be undone. Enrollment (AWTD-1668) and later tasks add
 * their types here; tests/rules/runtime-binding-audit-event-types-are-classified.test.ts
 * fails while a literal event type written anywhere is unclassified.
 */

import type { Prisma } from '@prisma/client'

export type AuditRetentionClass = 'operational' | 'lifecycle'

/**
 * Every known event type, and its class. The ONE place this is decided.
 *
 * Lifecycle covers the four record kinds Jon named (consent, approval,
 * revocation, run attribution) plus the configuration history they refer to:
 * an approval names a revision, so the revision's creation outlives it too.
 */
export const RUNTIME_BINDING_AUDIT_EVENT_CLASS = {
  // ── Lifecycle: registration, consent and approval ─────────────────────────
  enrolled: 'lifecycle',
  'revision-created': 'lifecycle',
  'scope-changed': 'lifecycle',
  'custodian-accepted': 'lifecycle',
  'custodian-declined': 'lifecycle',
  'payer-accepted': 'lifecycle',
  'payer-declined': 'lifecycle',
  verified: 'lifecycle',
  'verification-failed': 'lifecycle',
  approved: 'lifecycle',
  'approval-rejected': 'lifecycle',
  activated: 'lifecycle',
  'board-attached': 'lifecycle',
  'board-detached': 'lifecycle',
  'credential-rotated': 'lifecycle',
  // ── Lifecycle: suspension and revocation ──────────────────────────────────
  suspended: 'lifecycle',
  resumed: 'lifecycle',
  revoked: 'lifecycle',
  // ── Lifecycle: run attribution ────────────────────────────────────────────
  'run-started': 'lifecycle',
  'run-finished': 'lifecycle',
  'run-cancelled': 'lifecycle',
  // ── Lifecycle: reads of the trail itself ──────────────────────────────────
  'audit-exported': 'lifecycle',

  // ── Operational: the detailed diagnostic stream ───────────────────────────
  'resolution-bound': 'operational',
  'resolution-denied': 'operational',
  'claim-denied': 'operational',
  'capacity-exhausted': 'operational',
  'verification-challenge-sent': 'operational',
  'lease-renewed': 'operational',
  'lease-lost': 'operational',
  'transport-attempted': 'operational',
  'transport-failed': 'operational',
} as const satisfies Record<string, AuditRetentionClass>

export type KnownRuntimeBindingAuditEventType = keyof typeof RUNTIME_BINDING_AUDIT_EVENT_CLASS

/** Exactly the types the prune may delete by age alone, derived from the map. */
export const OPERATIONAL_AUDIT_EVENT_TYPES: readonly string[] = Object.entries(RUNTIME_BINDING_AUDIT_EVENT_CLASS)
  .filter(([, cls]) => cls === 'operational')
  .map(([type]) => type)

/** The class of an event type. Anything not in the map is lifecycle. */
export function auditEventClass(eventType: string): AuditRetentionClass {
  return Object.prototype.hasOwnProperty.call(RUNTIME_BINDING_AUDIT_EVENT_CLASS, eventType)
    ? RUNTIME_BINDING_AUDIT_EVENT_CLASS[eventType as KnownRuntimeBindingAuditEventType]
    : 'lifecycle'
}

// ── Windows ─────────────────────────────────────────────────────────────────

/** Jon's decision 5: both windows are ninety days. Nothing may go below it. */
export const RUNTIME_BINDING_AUDIT_DEFAULT_DAYS = 90

/**
 * Upper bound on an override: a century. Only there so a typo of extra digits
 * cannot push the cutoff outside the range a Date can hold.
 */
export const RUNTIME_BINDING_AUDIT_MAX_DAYS = 36_500

export interface AuditRetentionPolicy {
  /** Operational events older than this are deleted. */
  operationalDays: number
  /** Lifecycle events go this long after revocation (and after being written). */
  lifecycleDays: number
}

/**
 * A deployment override, read so that it can only EXTEND a window. Blank,
 * malformed, fractional or shorter-than-default values all mean the default:
 * a mistake in configuration must never delete more than Jon decided.
 */
export function retentionDaysFrom(raw: string | undefined): number {
  const value = raw?.trim()
  if (!value || !/^\d+$/.test(value)) return RUNTIME_BINDING_AUDIT_DEFAULT_DAYS
  const days = Number(value)
  if (days < RUNTIME_BINDING_AUDIT_DEFAULT_DAYS) return RUNTIME_BINDING_AUDIT_DEFAULT_DAYS
  return Math.min(days, RUNTIME_BINDING_AUDIT_MAX_DAYS)
}

/** Shape check for lib/env.ts: says why a value would be ignored. */
export function retentionDaysProblem(raw: string): string | null {
  const value = raw.trim()
  if (!/^\d+$/.test(value)) return 'Must be a whole number of days'
  if (Number(value) < RUNTIME_BINDING_AUDIT_DEFAULT_DAYS) {
    return `Must be at least ${RUNTIME_BINDING_AUDIT_DEFAULT_DAYS}; a shorter value is ignored`
  }
  return null
}

/**
 * The effective policy. `env` is passed in so tests do not touch process.env;
 * production passes the values lib/env.ts reads.
 */
export function auditRetentionPolicy(env: {
  RUNTIME_BINDING_AUDIT_OPERATIONAL_DAYS?: string
  RUNTIME_BINDING_AUDIT_LIFECYCLE_DAYS?: string
}): AuditRetentionPolicy {
  return {
    operationalDays: retentionDaysFrom(env.RUNTIME_BINDING_AUDIT_OPERATIONAL_DAYS),
    lifecycleDays: retentionDaysFrom(env.RUNTIME_BINDING_AUDIT_LIFECYCLE_DAYS),
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

export interface AuditRetentionCutoffs {
  operational: Date
  lifecycle: Date
}

export function auditRetentionCutoffs(now: Date, policy: AuditRetentionPolicy): AuditRetentionCutoffs {
  return {
    operational: new Date(now.getTime() - policy.operationalDays * DAY_MS),
    lifecycle: new Date(now.getTime() - policy.lifecycleDays * DAY_MS),
  }
}

// ── What each class may lose ────────────────────────────────────────────────

/** Operational events strictly older than the cutoff. Only listed types: an unknown type is never matched. */
export function operationalPruneWhere(cutoff: Date): Prisma.RuntimeBindingAuditEventWhereInput {
  return { eventType: { in: [...OPERATIONAL_AUDIT_EVENT_TYPES] }, createdAt: { lt: cutoff } }
}

/**
 * Lifecycle (and unknown) events, only when BOTH hold:
 *
 *  - the event itself is older than the cutoff, so a record written after the
 *    revocation (an export of a revoked binding's trail) keeps its own window;
 *  - its binding was revoked more than the window ago: state `revoked` AND a
 *    `revokedAt` before the cutoff. A revoked state with no timestamp has no
 *    clock to start, and a timestamp on a non-revoked state is not trusted, so
 *    both are kept. Or the event has no binding at all (a denial recorded before
 *    any binding resolved), which has no lifecycle to outlive.
 *
 * The binding row cannot vanish under its events (the relation is Restrict), so
 * "no binding" is the null bindingId case.
 */
export function lifecyclePruneWhere(cutoff: Date): Prisma.RuntimeBindingAuditEventWhereInput {
  return {
    eventType: { notIn: [...OPERATIONAL_AUDIT_EVENT_TYPES] },
    createdAt: { lt: cutoff },
    OR: [
      { bindingId: null },
      { binding: { is: { state: 'revoked', revokedAt: { lt: cutoff } } } },
    ],
  }
}
