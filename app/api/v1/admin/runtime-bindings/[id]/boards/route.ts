/**
 * POST   /api/v1/admin/runtime-bindings/:id/boards { boardId } — bind a board.
 * DELETE /api/v1/admin/runtime-bindings/:id/boards?boardId= — unbind it.
 *
 * Only boards in the binding's allowedBoardIds, only by an admin who also
 * manages the board, always audited. A conflict is HELD: if a task on the board
 * also sits on a board bound to a different binding, the attach is refused (409
 * `board-conflict`) with the conflicting boards named. Detach works even where
 * enrollment is gated off.
 *
 * AWTD-1668. Browser session only (lib/runtime-binding/enrollment.ts).
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { attachBoardToRuntimeBinding, detachBoardFromRuntimeBinding } from '@/lib/runtime-binding/enrollment'
import {
  enrollmentErrorResponse,
  readJsonBody,
  refuseUnlessHumanSession,
} from '@/lib/runtime-binding/admin-route'

type Ctx = { params: Promise<{ id: string }> }

function boardIdOf(body: Record<string, unknown> | null): string | null {
  const value = body?.boardId
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const missingBoard = () =>
  NextResponse.json({ error: 'boardId is required.', code: 'invalid-input' }, { status: 400 })

export const POST = withAuth({ tag: 'v1.admin.runtime-bindings' }, async (req, auth, ctx: Ctx) => {
  const refused = refuseUnlessHumanSession(auth)
  if (refused) return refused
  const { id } = await ctx.params
  const boardId = boardIdOf(await readJsonBody(req))
  if (!boardId) return missingBoard()
  try {
    await attachBoardToRuntimeBinding({ userId: auth.userId }, id, boardId)
    return NextResponse.json({ attached: { bindingId: id, boardId } })
  } catch (thrown) {
    return enrollmentErrorResponse(thrown)
  }
})

export const DELETE = withAuth({ tag: 'v1.admin.runtime-bindings' }, async (req, auth, ctx: Ctx) => {
  const refused = refuseUnlessHumanSession(auth)
  if (refused) return refused
  const { id } = await ctx.params
  const boardId = req.nextUrl.searchParams.get('boardId')?.trim()
  if (!boardId) return missingBoard()
  try {
    await detachBoardFromRuntimeBinding({ userId: auth.userId }, id, boardId)
    return NextResponse.json({ detached: { bindingId: id, boardId } })
  } catch (thrown) {
    return enrollmentErrorResponse(thrown)
  }
})
