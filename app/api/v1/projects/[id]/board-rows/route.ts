/**
 * Project board rows API v1 — /api/v1/projects/:id/board-rows (AWTD-1660)
 *
 *   GET            → { listIds: string[] | null }   null = nothing saved yet
 *   PUT { listIds } → { listIds: string[] }
 *
 * Which lists the caller's multi-list board for this project shows as rows,
 * saved per person per project so it follows them to every device. Ordered:
 * the rows draw in the order saved.
 *
 * Gated on Project Mode first (`projectModeGate`: 404 when the deployment does
 * not ship it, 403 `not_granted` when this person has not been given it), then
 * the project's owner or a member, then — on PUT — every list must be one the
 * caller can see; one that is not refuses the whole write with 403 and names it.
 * The rules live in lib/project-board-view.ts.
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { projectModeGate } from '@/lib/project-mode'
import {
  parseBoardRowListIds,
  readProjectBoardRows,
  saveProjectBoardRows,
  type BoardViewRefusal,
} from '@/lib/project-board-view'
import { PROJECT_BOARD_MAX_ROWS } from '@/lib/project-board-rows'

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function refusal(result: BoardViewRefusal) {
  if (result.error === 'not_found') return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (result.error === 'forbidden') return NextResponse.json({ error: 'Not a member of this project' }, { status: 403 })
  return NextResponse.json({ error: 'You cannot see one or more of these lists', listIds: result.listIds }, { status: 403 })
}

export const GET = withAuth<RouteContext>(
  { scopes: ['projects:read'], tag: 'v1.projects.board-rows' },
  async (_req, auth, { params }) => {
    const gated = await projectModeGate(auth.userId)
    if (gated) return gated
    const { id: projectId } = await params

    const result = await readProjectBoardRows(auth.userId, projectId)
    if ('error' in result) return refusal(result)
    return NextResponse.json(
      { listIds: result.listIds, meta: { apiVersion: 'v1' } },
      { headers: { 'Cache-Control': 'private, no-cache' } },
    )
  },
)

export const PUT = withAuth<RouteContext>(
  { scopes: ['projects:write'], tag: 'v1.projects.board-rows' },
  async (req, auth, { params }) => {
    const gated = await projectModeGate(auth.userId)
    if (gated) return gated
    const { id: projectId } = await params

    const body = await req.json().catch(() => null)
    const listIds = parseBoardRowListIds(body?.listIds)
    if (!listIds) {
      return NextResponse.json({ error: `listIds must be an array of at most ${PROJECT_BOARD_MAX_ROWS} list ids` }, { status: 400 })
    }

    const result = await saveProjectBoardRows(auth.userId, projectId, listIds)
    if ('error' in result) return refusal(result)
    return NextResponse.json({ listIds: result.listIds, meta: { apiVersion: 'v1' } })
  },
)
