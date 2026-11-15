/**
 * GET /api/cron/binding-audit — runtime-binding audit retention (AWTD-1670).
 *
 * Daily (vercel.json; the self-host runner and the Azure Jobs read the same
 * list). Deletes operational RuntimeBindingAuditEvent rows past their 90 days,
 * and lifecycle rows only once their binding has been revoked for more than 90
 * days. lib/runtime-binding/audit-retention.ts has the rules and the classes;
 * RUNTIME_BINDING_AUDIT_OPERATIONAL_DAYS / _LIFECYCLE_DAYS can only extend them.
 *
 * The path's last segment is short on purpose: Azure names a Job
 * `<name>-cron-<segment>` and caps it at 32 characters.
 *
 * Same secret as every cron route; fails closed without it.
 */
import { NextRequest } from 'next/server'
import { requireCronSecret } from '@/lib/cron-auth'
import { runCronJob } from '@/lib/cron-observability'
import { pruneRuntimeBindingAuditEvents } from '@/lib/runtime-binding/audit-retention-service'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const blocked = requireCronSecret(request)
  if (blocked) return blocked

  return runCronJob('runtime-binding-audit-retention', async () => {
    const summary = await pruneRuntimeBindingAuditEvents()
    return { ...summary }
  })
}
