/**
 * Board statuses API v1 — /api/v1/projects/:id/statuses (AWTD-883)
 *
 * The versioned half of `/api/statuses`. Every other path the Windows and iOS
 * clients speak is `/api/v1/...`; board columns were the one exception, and it
 * had to be carried in each client as a special case.
 *
 *   POST   { name }               add a custom column
 *   PATCH  { role, name }         rename a column (built-in or custom)
 *   PUT    { role, direction }    move a custom column one slot up or down
 *   DELETE { role }               remove a custom column
 *
 * **The board is the path segment.** `/api/statuses` takes `projectId` in the
 * body; here it is `:id`, and a `projectId` in the body is ignored rather than
 * consulted — honouring it would let a caller authorised for one board write a
 * column onto another.
 *
 * Everything else is the unversioned route's behaviour, unchanged, because it
 * is literally the same service functions: the rules live in
 * `lib/project-custom-states.ts` (and are locked into the Windows core by a
 * generated fixture), and `lib/projects-service.ts` is the only writer. This
 * route is authorisation, wire shape, and cache invalidation.
 *
 * `/api/statuses` keeps working: this is additive, so clients move when they
 * move.
 *
 * Scope is `projects:write` for all four verbs, DELETE included — removing a
 * *column* updates the board's configuration, it does not delete the board.
 * `projects:delete` stays what it says, the same way `/api/v1/lists/[id]/members`
 * uses `lists:write` to remove a member.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'
import { RedisCache } from '@/lib/redis'
import {
  addUserStatus,
  authorizeBoardOwner,
  removeUserStatus,
  renameUserStatus,
  reorderUserStatus,
} from '@/lib/projects-service'
import type { AuthContext } from '@/lib/api-auth-middleware'
import type { StatusState } from '@/lib/task-status'

const log = createLogger('v1.projects.statuses')

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** What the four service functions can answer with when they refuse. */
type ServiceFailure = { error: 'invalid' | 'duplicate' | 'not_found'; message: string }
type ServiceResult = ServiceFailure | { state: StatusState; userIdsToInvalidate: Set<string> }

const FAILURE_STATUS: Record<ServiceFailure['error'], number> = {
  duplicate: 409,
  not_found: 404,
  invalid: 400,
}

function ownerFailure(result: { error: 'not_found' | 'forbidden' }, verb: string) {
  return result.error === 'not_found'
    ? NextResponse.json({ error: 'Project not found' }, { status: 404 })
    : NextResponse.json({ error: `Only the board owner can ${verb}` }, { status: 403 })
}

/**
 * The shape every verb here shares: authorize the board named in the path, run
 * the service function, invalidate, answer the v1 envelope.
 *
 * Written once rather than four times — the unversioned route repeats it per
 * verb, and the copies had already drifted in their error strings.
 */
async function mutateBoardStatuses(
  request: NextRequest,
  auth: AuthContext,
  { params }: RouteContext,
  verb: string,
  run: (body: Record<string, unknown>, projectId: string) => Promise<ServiceResult> | ServiceResult,
): Promise<NextResponse> {
  const { id: projectId } = await params

  const authorized = await authorizeBoardOwner(projectId, auth.userId)
  if ('error' in authorized) return ownerFailure(authorized, verb)

  const body = await request.json().catch(() => ({}))
  const result = await run(body ?? {}, projectId)

  if ('error' in result) {
    return NextResponse.json({ error: result.message }, { status: FAILURE_STATUS[result.error] })
  }

  try {
    await RedisCache.invalidate.userListsAllVersions(auth.userId)
  } catch (error) {
    log.error({ err: error }, 'Failed to invalidate user lists cache')
  }

  const headers: Record<string, string> = {}
  const deprecationWarning = getDeprecationWarning(auth)
  if (deprecationWarning) {
    headers['X-Deprecation-Warning'] = deprecationWarning
  }

  return NextResponse.json(
    { state: result.state, meta: { apiVersion: 'v1', authSource: auth.source } },
    { headers },
  )
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Add a custom column. Body: `{ name }`. */
export const POST = withAuth<RouteContext>(
  { scopes: ['projects:write'], tag: 'v1.projects.statuses' },
  (request, auth, context) =>
    mutateBoardStatuses(request, auth, context, 'add a status', (body, projectId) =>
      addUserStatus(auth.userId, asString(body.name), projectId),
    ),
)

/**
 * Rename a column. Body: `{ role, name }`.
 *
 * The role survives the rename — tasks point at their column by `statusRole`,
 * so minting a fresh one would orphan every card in it.
 */
export const PATCH = withAuth<RouteContext>(
  { scopes: ['projects:write'], tag: 'v1.projects.statuses' },
  (request, auth, context) =>
    mutateBoardStatuses(request, auth, context, 'rename a status', (body, projectId) => {
      const role = asString(body.role)
      if (!role) {
        return { error: 'invalid', message: 'Which status to rename is required' }
      }
      return renameUserStatus(auth.userId, role, asString(body.name), projectId)
    }),
)

/** Move a custom column one slot. Body: `{ role, direction: "up" | "down" }`. */
export const PUT = withAuth<RouteContext>(
  { scopes: ['projects:write'], tag: 'v1.projects.statuses' },
  (request, auth, context) =>
    mutateBoardStatuses(request, auth, context, 'reorder statuses', (body, projectId) => {
      const role = asString(body.role)
      if (!role) {
        return { error: 'invalid', message: 'Which status to move is required' }
      }
      if (body.direction !== 'up' && body.direction !== 'down') {
        return { error: 'invalid', message: "direction must be 'up' or 'down'" }
      }
      return reorderUserStatus(auth.userId, role, body.direction, projectId)
    }),
)

/**
 * Remove a custom column. Body: `{ role }`.
 *
 * Tasks that were in the column have their `statusRole` cleared, so they fall
 * back to Inbox rather than matching no column at all.
 */
export const DELETE = withAuth<RouteContext>(
  { scopes: ['projects:write'], tag: 'v1.projects.statuses' },
  (request, auth, context) =>
    mutateBoardStatuses(request, auth, context, 'delete a status', (body, projectId) => {
      const role = asString(body.role)
      if (!role) {
        return { error: 'invalid', message: 'Which status to delete is required' }
      }
      return removeUserStatus(auth.userId, role, projectId)
    }),
)
