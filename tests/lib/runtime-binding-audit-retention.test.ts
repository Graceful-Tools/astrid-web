// @vitest-environment node
/**
 * AWTD-1670: retention for RuntimeBindingAuditEvent (Jon's decision 5, 2026-11-14;
 * docs/architecture/BUSINESS_RUNTIME_BINDING_RFC.md §7).
 *
 *  - operational events: 90 days, then pruned;
 *  - lifecycle events (consent, approval, revocation, run attribution, export):
 *    kept for the binding's lifecycle plus 90 days;
 *  - a deployment may keep either longer, never shorter.
 *
 * The prune is exercised against an in-memory table that evaluates the REAL
 * Prisma where clauses the service builds, so a boundary here is a boundary in
 * the query, not in a parallel predicate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  RUNTIME_BINDING_AUDIT_DEFAULT_DAYS,
  RUNTIME_BINDING_AUDIT_EVENT_CLASS,
  OPERATIONAL_AUDIT_EVENT_TYPES,
  auditEventClass,
  auditRetentionPolicy,
  auditRetentionCutoffs,
} from '@/lib/runtime-binding/audit-retention'
import {
  pruneRuntimeBindingAuditEvents,
  RUNTIME_BINDING_AUDIT_PRUNE_BATCH_SIZE,
  RUNTIME_BINDING_AUDIT_PRUNE_MAX_BATCHES,
} from '@/lib/runtime-binding/audit-retention-service'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-11-14T12:00:00.000Z')
const daysAgo = (d: number, extraMs = 0) => new Date(NOW.getTime() - d * DAY - extraMs)

// ── An in-memory RuntimeBindingAuditEvent table ──────────────────────────────

interface Binding { id: string; state: string; revokedAt: Date | null }
interface Event { id: string; bindingId: string | null; eventType: string; createdAt: Date }

/** Evaluates exactly the operators the service uses; anything else throws, so a
 *  new operator cannot pass by being ignored. */
function matches(row: Record<string, any>, where: Record<string, any>, bindings: Map<string, Binding>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'AND') { if (!(cond as any[]).every(w => matches(row, w, bindings))) return false; continue }
    if (key === 'OR') { if (!(cond as any[]).some(w => matches(row, w, bindings))) return false; continue }
    if (key === 'binding') {
      const b = row.bindingId ? bindings.get(row.bindingId) : undefined
      if (!b) return false
      if (!matches(b as any, (cond as any).is, bindings)) return false
      continue
    }
    const value = row[key]
    if (cond === null) { if (value !== null) return false; continue }
    if (typeof cond !== 'object' || cond instanceof Date) { if (value !== cond) return false; continue }
    for (const [op, arg] of Object.entries(cond)) {
      if (op === 'in') { if (!(arg as unknown[]).includes(value)) return false }
      else if (op === 'notIn') { if ((arg as unknown[]).includes(value)) return false }
      else if (op === 'lt') { if (!(value instanceof Date) || !(value.getTime() < (arg as Date).getTime())) return false }
      else throw new Error(`unsupported operator ${op}`)
    }
  }
  return true
}

function table(events: Event[], bindingList: Binding[]) {
  const bindings = new Map(bindingList.map(b => [b.id, b]))
  let rows = [...events]
  const calls = { findMany: 0, deleteMany: 0 }
  const delegate = {
    findMany: vi.fn(async ({ where, take }: any) => {
      calls.findMany++
      return rows
        .filter(r => matches(r, where, bindings))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, take)
        .map(r => ({ id: r.id }))
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      calls.deleteMany++
      const doomed = rows.filter(r => matches(r, where, bindings))
      rows = rows.filter(r => !doomed.includes(r))
      return { count: doomed.length }
    }),
  }
  return { client: { runtimeBindingAuditEvent: delegate }, ids: () => rows.map(r => r.id).sort(), calls, delegate }
}

const ev = (id: string, eventType: string, createdAt: Date, bindingId: string | null = 'b-active'): Event => ({
  id, bindingId, eventType, createdAt,
})

const BINDINGS: Binding[] = [
  { id: 'b-active', state: 'active', revokedAt: null },
  { id: 'b-suspended', state: 'suspended', revokedAt: null },
  { id: 'b-pending', state: 'pending', revokedAt: null },
  { id: 'b-revoked-long', state: 'revoked', revokedAt: daysAgo(91) },
  { id: 'b-revoked-recent', state: 'revoked', revokedAt: daysAgo(89) },
  { id: 'b-revoked-boundary', state: 'revoked', revokedAt: daysAgo(90) },
  // revokedAt set on a binding whose state is not revoked: not trusted as revoked.
  { id: 'b-inconsistent', state: 'active', revokedAt: daysAgo(400) },
  // state revoked but no timestamp: we cannot start the clock, so it is kept.
  { id: 'b-revoked-no-ts', state: 'revoked', revokedAt: null },
]

const prune = (t: ReturnType<typeof table>, env: Record<string, string | undefined> = {}) =>
  pruneRuntimeBindingAuditEvents({ prisma: t.client as never, now: NOW, env })

// ── Classification ──────────────────────────────────────────────────────────

describe('AWTD-1670: audit event classification', () => {
  it('AWTD-1670: classifies consent, approval, revocation, run attribution and export as lifecycle', () => {
    for (const type of ['enrolled', 'custodian-accepted', 'payer-accepted', 'approved', 'activated',
      'suspended', 'resumed', 'revoked', 'run-started', 'run-finished', 'audit-exported']) {
      expect(auditEventClass(type), type).toBe('lifecycle')
    }
  })

  it('AWTD-1670: classifies resolution denials and transport detail as operational', () => {
    for (const type of ['resolution-denied', 'transport-attempted', 'lease-renewed']) {
      expect(auditEventClass(type), type).toBe('operational')
    }
  })

  it('AWTD-1670: an unknown event type is lifecycle, the keep-longer side', () => {
    expect(auditEventClass('something-enrollment-invents-later')).toBe('lifecycle')
    expect(auditEventClass('')).toBe('lifecycle')
  })

  it('AWTD-1670: the operational list is derived from the one map', () => {
    expect([...OPERATIONAL_AUDIT_EVENT_TYPES].sort()).toEqual(
      Object.entries(RUNTIME_BINDING_AUDIT_EVENT_CLASS).filter(([, c]) => c === 'operational').map(([t]) => t).sort(),
    )
  })

  it('AWTD-1670: inherited object keys are not event types', () => {
    expect(auditEventClass('toString')).toBe('lifecycle')
    expect(auditEventClass('constructor')).toBe('lifecycle')
  })
})

// ── Policy and the override ────────────────────────────────────────────────

describe('AWTD-1670: retention policy and the deployment override', () => {
  it('AWTD-1670: defaults to 90 days for both classes', () => {
    expect(RUNTIME_BINDING_AUDIT_DEFAULT_DAYS).toBe(90)
    expect(auditRetentionPolicy({})).toEqual({ operationalDays: 90, lifecycleDays: 90 })
  })

  it('AWTD-1670: an override can extend either window', () => {
    expect(auditRetentionPolicy({
      RUNTIME_BINDING_AUDIT_OPERATIONAL_DAYS: '180',
      RUNTIME_BINDING_AUDIT_LIFECYCLE_DAYS: '2555',
    })).toEqual({ operationalDays: 180, lifecycleDays: 2555 })
  })

  it('AWTD-1670: an override can never shorten a window', () => {
    expect(auditRetentionPolicy({
      RUNTIME_BINDING_AUDIT_OPERATIONAL_DAYS: '30',
      RUNTIME_BINDING_AUDIT_LIFECYCLE_DAYS: '0',
    })).toEqual({ operationalDays: 90, lifecycleDays: 90 })
    expect(auditRetentionPolicy({ RUNTIME_BINDING_AUDIT_OPERATIONAL_DAYS: '-500' }).operationalDays).toBe(90)
  })

  it('AWTD-1670: a malformed override falls back to the default rather than deleting more', () => {
    for (const raw of ['', ' ', 'ninety', '120.5', '1e3', 'NaN', 'Infinity', '120days']) {
      expect(auditRetentionPolicy({ RUNTIME_BINDING_AUDIT_OPERATIONAL_DAYS: raw }).operationalDays, raw).toBe(90)
    }
  })

  it('AWTD-1670: an absurdly long override is capped so the cutoff stays a valid date', () => {
    const policy = auditRetentionPolicy({ RUNTIME_BINDING_AUDIT_LIFECYCLE_DAYS: '999999999' })
    expect(policy.lifecycleDays).toBeGreaterThan(90)
    const { lifecycle } = auditRetentionCutoffs(NOW, policy)
    expect(Number.isNaN(lifecycle.getTime())).toBe(false)
  })

  it('AWTD-1670: cutoffs are exactly N days before now', () => {
    const cutoffs = auditRetentionCutoffs(NOW, { operationalDays: 90, lifecycleDays: 120 })
    expect(cutoffs.operational.toISOString()).toBe(daysAgo(90).toISOString())
    expect(cutoffs.lifecycle.toISOString()).toBe(daysAgo(120).toISOString())
  })
})

// ── The prune ───────────────────────────────────────────────────────────────

describe('AWTD-1670: pruning operational events at 90 days', () => {
  beforeEach(() => vi.clearAllMocks())

  it('AWTD-1670: deletes operational events older than 90 days and keeps those at or inside it', async () => {
    const t = table([
      ev('op-91', 'resolution-denied', daysAgo(91)),
      ev('op-90-plus-1ms', 'resolution-denied', daysAgo(90, 1)),
      ev('op-exactly-90', 'resolution-denied', daysAgo(90)),
      ev('op-89', 'resolution-denied', daysAgo(89)),
      ev('op-unbound-200', 'resolution-denied', daysAgo(200), null),
    ], BINDINGS)
    const summary = await prune(t)
    expect(t.ids()).toEqual(['op-89', 'op-exactly-90'])
    expect(summary).toMatchObject({ operationalDeleted: 3, lifecycleDeleted: 0, operationalDays: 90, lifecycleDays: 90 })
  })

  it('AWTD-1670: an extended operational window keeps what the default would delete', async () => {
    const t = table([ev('op-120', 'transport-attempted', daysAgo(120)), ev('op-200', 'transport-attempted', daysAgo(200))], BINDINGS)
    await prune(t, { RUNTIME_BINDING_AUDIT_OPERATIONAL_DAYS: '180' })
    expect(t.ids()).toEqual(['op-120'])
  })

  it('AWTD-1670: a shortening override deletes nothing the default would keep', async () => {
    const t = table([ev('op-60', 'transport-attempted', daysAgo(60))], BINDINGS)
    await prune(t, { RUNTIME_BINDING_AUDIT_OPERATIONAL_DAYS: '30' })
    expect(t.ids()).toEqual(['op-60'])
  })
})

describe('AWTD-1670: lifecycle events survive while the binding lives', () => {
  it('AWTD-1670: never deletes lifecycle events of an active, suspended or pending binding, however old', async () => {
    const t = table([
      ev('active-enrolled', 'enrolled', daysAgo(2000), 'b-active'),
      ev('active-run', 'run-started', daysAgo(400), 'b-active'),
      ev('suspended-approved', 'approved', daysAgo(1000), 'b-suspended'),
      ev('suspended-suspended', 'suspended', daysAgo(500), 'b-suspended'),
      ev('pending-enrolled', 'enrolled', daysAgo(365), 'b-pending'),
      ev('inconsistent-revoked', 'revoked', daysAgo(400), 'b-inconsistent'),
      ev('revoked-no-ts', 'revoked', daysAgo(400), 'b-revoked-no-ts'),
    ], BINDINGS)
    const summary = await prune(t)
    expect(t.ids()).toHaveLength(7)
    expect(summary.lifecycleDeleted).toBe(0)
  })

  it('AWTD-1670: an unknown event type on a live binding is kept like lifecycle', async () => {
    const t = table([ev('mystery', 'not-yet-classified', daysAgo(1000), 'b-active')], BINDINGS)
    await prune(t)
    expect(t.ids()).toEqual(['mystery'])
  })
})

describe('AWTD-1670: lifecycle events are pruned 90 days after revocation', () => {
  it('AWTD-1670: deletes old lifecycle events once the binding has been revoked for more than 90 days', async () => {
    const t = table([
      ev('long-enrolled', 'enrolled', daysAgo(500), 'b-revoked-long'),
      ev('long-revoked', 'revoked', daysAgo(91), 'b-revoked-long'),
      ev('long-unknown', 'not-yet-classified', daysAgo(300), 'b-revoked-long'),
      ev('recent-enrolled', 'enrolled', daysAgo(500), 'b-revoked-recent'),
      ev('recent-revoked', 'revoked', daysAgo(89), 'b-revoked-recent'),
      ev('boundary-enrolled', 'enrolled', daysAgo(500), 'b-revoked-boundary'),
    ], BINDINGS)
    const summary = await prune(t)
    // Revoked 89 days ago, or exactly 90: not yet "more than 90 days".
    expect(t.ids()).toEqual(['boundary-enrolled', 'recent-enrolled', 'recent-revoked'])
    expect(summary.lifecycleDeleted).toBe(3)
  })

  it('AWTD-1670: a lifecycle record written after revocation (e.g. an export) keeps its own 90 days', async () => {
    const t = table([
      ev('late-export', 'audit-exported', daysAgo(10), 'b-revoked-long'),
      ev('old-export', 'audit-exported', daysAgo(95), 'b-revoked-long'),
    ], BINDINGS)
    await prune(t)
    expect(t.ids()).toEqual(['late-export'])
  })

  it('AWTD-1670: an extended lifecycle window keeps a binding revoked 91 days ago', async () => {
    const t = table([ev('long-enrolled', 'enrolled', daysAgo(500), 'b-revoked-long')], BINDINGS)
    await prune(t, { RUNTIME_BINDING_AUDIT_LIFECYCLE_DAYS: '365' })
    expect(t.ids()).toEqual(['long-enrolled'])
  })

  it('AWTD-1670: a lifecycle event with no binding at all goes 90 days after it was written', async () => {
    const t = table([
      ev('orphan-old', 'run-started', daysAgo(91), null),
      ev('orphan-new', 'run-started', daysAgo(30), null),
    ], BINDINGS)
    await prune(t)
    expect(t.ids()).toEqual(['orphan-new'])
  })
})

describe('AWTD-1670: bounded and idempotent', () => {
  it('AWTD-1670: deletes in bounded batches and stops at the per-run cap', async () => {
    const total = RUNTIME_BINDING_AUDIT_PRUNE_BATCH_SIZE * (RUNTIME_BINDING_AUDIT_PRUNE_MAX_BATCHES + 1)
    const events = Array.from({ length: total }, (_, i) => ev(`op-${i}`, 'resolution-denied', daysAgo(100, i)))
    const t = table(events, BINDINGS)
    const summary = await prune(t)
    expect(summary.operationalDeleted).toBe(RUNTIME_BINDING_AUDIT_PRUNE_BATCH_SIZE * RUNTIME_BINDING_AUDIT_PRUNE_MAX_BATCHES)
    expect(summary.capped).toBe(true)
    for (const [args] of t.delegate.findMany.mock.calls) {
      expect((args as any).take).toBeLessThanOrEqual(RUNTIME_BINDING_AUDIT_PRUNE_BATCH_SIZE)
    }
    // The next run drains the rest.
    const next = await prune(t)
    expect(next.operationalDeleted).toBe(RUNTIME_BINDING_AUDIT_PRUNE_BATCH_SIZE)
    expect(t.ids()).toEqual([])
  })

  it('AWTD-1670: a second run deletes nothing', async () => {
    const t = table([
      ev('op-old', 'resolution-denied', daysAgo(120)),
      ev('lc-old', 'enrolled', daysAgo(500), 'b-revoked-long'),
      ev('lc-live', 'enrolled', daysAgo(500), 'b-active'),
    ], BINDINGS)
    const first = await prune(t)
    expect(first.operationalDeleted + first.lifecycleDeleted).toBe(2)
    const second = await prune(t)
    expect(second).toMatchObject({ operationalDeleted: 0, lifecycleDeleted: 0, capped: false })
    expect(t.ids()).toEqual(['lc-live'])
  })

  it('AWTD-1670: the delete re-applies the retention filter, not just the ids it selected', async () => {
    const t = table([ev('op-old', 'resolution-denied', daysAgo(120))], BINDINGS)
    await prune(t)
    for (const [args] of t.delegate.deleteMany.mock.calls) {
      expect((args as any).where.AND).toHaveLength(2)
    }
  })
})
