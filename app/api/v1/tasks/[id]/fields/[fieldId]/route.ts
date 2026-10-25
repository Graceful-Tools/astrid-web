/**
 * PUT /api/v1/tasks/:id/fields/:fieldId — edit one GitHub project field value
 * from Astrid, written through to GitHub (AWTD-1209, P6a-3).
 *
 * Spec §9.4.2. The schema that explains these fields is
 * `GET /api/v1/projects/:id/fields` (AWTD-1208); this is the write half.
 *
 * **404 when the capability is off**, through `withAuth`'s `capability`
 * option — resolved at module load, so a deployment without `githubProjects`
 * pays nothing for a route it does not have.
 *
 * The rules live in `setProjectFieldValue`; this file is the wire envelope and
 * the status mapping, which is also what keeps it out of the direct-Prisma
 * ratchet.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { setProjectFieldValue } from '@/services/github-project-fields.service'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.tasks.fields')

type RouteContext = { params: Promise<{ id: string; fieldId: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PUT = withAuth<RouteContext>(
  { scopes: ['tasks:write'], capability: 'githubProjects', tag: 'v1.tasks.fields' },
  async (req, auth, { params }) => {
    const { id: taskId, fieldId } = await params

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    }
    // `{ "value": null }` clears the field, so the KEY must be present — an
    // empty body is a malformed request, not a clear.
    if (typeof body !== 'object' || body === null || !('value' in body)) {
      return NextResponse.json({ error: 'value_required' }, { status: 400 })
    }

    const result = await setProjectFieldValue(taskId, fieldId, (body as { value: unknown }).value, auth.userId)

    if ('error' in result) {
      return result.error === 'forbidden'
        ? NextResponse.json({ error: 'forbidden' }, { status: 403 })
        : NextResponse.json({ error: 'Task field not found' }, { status: 404 })
    }
    if ('refused' in result) {
      return NextResponse.json({ error: result.refused }, { status: 400 })
    }
    if ('backend' in result) {
      const { status, error, retryAfter, ssoUrl } = result.backend
      return NextResponse.json(
        { error, ...(retryAfter ? { retryAfter } : {}), ...(ssoUrl ? { ssoUrl } : {}) },
        { status, ...(retryAfter ? { headers: { 'Retry-After': String(retryAfter) } } : {}) },
      )
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) headers['X-Deprecation-Warning'] = deprecationWarning

    log.debug({ taskId, fieldId }, 'Wrote a project field value')

    return NextResponse.json(
      { field: { id: fieldId, value: result.scalar }, meta: { apiVersion: 'v1' } },
      { headers },
    )
  },
)
