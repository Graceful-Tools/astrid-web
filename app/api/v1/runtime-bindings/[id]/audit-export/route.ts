/**
 * GET /api/v1/runtime-bindings/:id/audit-export?format=json|csv (AWTD-1670)
 *
 * The controlled export of one runtime binding's audit trail (RFC §7). Returns a
 * download (Content-Disposition: attachment), not a `{ data, meta }` envelope.
 *
 * WHO. A deployment administrator (lib/admin-auth.ts, the explicitly
 * provisioned grant RFC §6 names for phase one), holding a full-access
 * credential: a browser session, never an OAuth token scoped to tasks or lists.
 * Anyone else gets 401/403 and nothing is read.
 *
 * WHAT. lib/runtime-binding/audit-export.ts writes an `audit-exported` event
 * first and refuses if it cannot; then the trail, each event with its retention
 * class, secret-named detail keys redacted. The response names that event in
 * X-Audit-Event-Id.
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { AdminAuthError, requireAdmin } from '@/lib/admin-auth'
import {
  auditExportToCsv,
  exportRuntimeBindingAuditTrail,
  isAuditExportFormat,
} from '@/lib/runtime-binding/audit-export'

export const maxDuration = 60

type Context = { params: Promise<{ id: string }> }

export const GET = withAuth<Context>(
  { scopes: ['*'], tag: 'v1.runtime-bindings.audit-export' },
  async (req, auth, ctx) => {
    try {
      await requireAdmin(auth.userId)
    } catch (error) {
      if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: 403 })
      throw error
    }

    const format = new URL(req.url).searchParams.get('format') ?? 'json'
    if (!isAuditExportFormat(format)) {
      return NextResponse.json({ error: 'format must be json or csv' }, { status: 400 })
    }

    const { id } = await ctx.params
    const result = await exportRuntimeBindingAuditTrail({ bindingId: id, actorUserId: auth.userId, format })
    if (result.status === 'not-found') {
      return NextResponse.json({ error: 'Runtime binding not found' }, { status: 404 })
    }

    const data = result.export
    const filename = `runtime-binding-${data.binding.id}-audit-${data.exportedAt.toISOString().slice(0, 10)}.${format}`
    const headers = {
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Audit-Event-Id': data.exportEventId,
      'X-Audit-Export-Truncated': String(data.truncated),
    }

    if (format === 'csv') {
      return new NextResponse(auditExportToCsv(data), {
        headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' },
      })
    }
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: { ...headers, 'Content-Type': 'application/json' },
    })
  },
)
