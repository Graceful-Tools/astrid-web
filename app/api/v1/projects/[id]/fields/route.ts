/**
 * GET /api/v1/projects/:id/fields — a GitHub project's field schema (AWTD-1208).
 *
 * Spec §9.4.3: *"Schema once per project."* Names, types, select options and
 * iteration definitions are served here, so the values on tasks can be the
 * compact `{ "<fieldId>": <scalar> }` map and nothing else. Without this route
 * every task payload would have to repeat the schema, which is the payload
 * problem §9.4.3 exists to avoid.
 *
 * **404 when the capability is off**, through `withAuth`'s `capability` option.
 * It is resolved at module load and short-circuits before authentication, so a
 * deployment without `githubProjects` pays nothing for a route it does not have.
 *
 * The rules — who may read it, and what the ETag is built from — are
 * `readProjectFieldSchema` in `services/github-project-fields.service.ts`. This
 * file is authorisation plumbing, cache headers and the wire envelope, which is
 * also what keeps it out of the direct-Prisma ratchet.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { readProjectFieldSchema } from '@/services/github-project-fields.service'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.projects.fields')

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withAuth<RouteContext>(
  { scopes: ['projects:read'], capability: 'githubProjects', tag: 'v1.projects.fields' },
  async (req, auth, { params }) => {
    const { id: projectId } = await params

    const result = await readProjectFieldSchema(projectId, auth.userId)
    if ('error' in result) {
      // 404 rather than 403: a board the caller cannot see must not be
      // distinguishable from one that does not exist.
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    if (req.headers.get('if-none-match') === result.etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: result.etag } }) as never
    }

    const headers: Record<string, string> = {
      ETag: result.etag,
      // Revalidate every time: the tag makes that cheap, and a stale schema
      // renders a task's fields wrong rather than merely late.
      'Cache-Control': 'private, no-cache',
    }
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) headers['X-Deprecation-Warning'] = deprecationWarning

    log.debug({ projectId, count: result.fields.length }, 'Served project field schema')

    return NextResponse.json(
      { fields: result.fields, meta: { apiVersion: 'v1', count: result.fields.length } },
      { headers },
    )
  },
)
