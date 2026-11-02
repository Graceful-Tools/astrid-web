/**
 * POST /api/v1/sync/existence — batch "which of my cached ids are gone?" (AWTD-1515)
 *
 * Body `{ taskIds?: string[], listIds?: string[] }`, at most
 * V1_EXISTENCE_MAX_IDS of each. Answers `{ missingTaskIds, missingListIds,
 * maxIds, meta }`. An id is missing exactly when the per-row GET
 * (`/api/v1/tasks/:id`, `/api/v1/lists/:id`) would answer 403 or 404: the
 * reads (services/sync-existence.service.ts) use the same `where` those GETs
 * use. One query per kind.
 *
 * Ids, not human identifiers (`AST-142`): a sync cache holds ids. An
 * identifier sent here is simply not a row id, so it comes back missing.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { requireScopes } from '@/lib/api-auth-middleware'
import { findReadableIds } from '@/services/sync-existence.service'
import { parseExistenceRequest, shapeExistenceResponse } from '@/lib/sync/v1-existence'

export const POST = withAuth(
  // Either read scope gets in; each kind then needs the scope its per-row GET
  // needs, so a tasks-only token can ask about tasks and nothing else.
  { anyOfScopes: ['tasks:read', 'lists:read'], tag: 'v1.sync.existence' },
  async (req, auth) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Body must be valid JSON' }, { status: 400 })
    }

    const parsed = parseExistenceRequest(body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { taskIds, listIds } = parsed

    // Throws ForbiddenError → withAuth answers 403.
    if (taskIds.length > 0) requireScopes(auth, ['tasks:read'])
    if (listIds.length > 0) requireScopes(auth, ['lists:read'])

    const visible = await findReadableIds(auth.userId, { taskIds, listIds })

    return NextResponse.json(
      shapeExistenceResponse({
        taskIds,
        visibleTaskIds: visible.taskIds,
        listIds,
        visibleListIds: visible.listIds,
        authSource: auth.source,
      })
    )
  }
)
