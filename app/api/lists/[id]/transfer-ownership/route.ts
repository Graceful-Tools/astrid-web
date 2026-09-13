/**
 * POST /api/lists/:id/transfer-ownership (legacy)
 *
 * The transfer rule — owner-only, successor-must-be-a-member, the atomic
 * ownerId-and-membership transaction, cache invalidation for both users — lives
 * in lib/list-ownership-transfer.ts and is shared with the v1 route. This
 * handler owns only session auth and a response with no `meta` envelope, which
 * is what actually differs between the two. (Task aa5a35f0.)
 *
 * It used to own the logic, and was the weaker of the two copies: it inlined
 * its owner check as `existingList.ownerId !== session.user.id` instead of
 * going through lib/list-permissions.ts — the exact shape CLAUDE.md rule 6 and
 * docs/CODE_REUSE_AND_CONSISTENCY.md exist to prevent, and the shape that
 * produced the four real bugs found in fix/list-member-service.
 */

import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { transferListOwnership } from "@/lib/list-ownership-transfer"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('lists.[id].transfer-ownership')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  context: RouteContextParams<{ id: string }>
) {
  try {
    const session = await getUnifiedSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: listId } = await context.params

    // A malformed or absent body is the caller's 400; the service reports the
    // missing field itself, so parse defensively and let it.
    let newOwnerId: unknown
    try {
      newOwnerId = (await request.json())?.newOwnerId
    } catch {
      newOwnerId = undefined
    }

    const result = await transferListOwnership({
      listId,
      currentUserId: session.user.id,
      newOwnerId: typeof newOwnerId === 'string' ? newOwnerId : '',
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ message: "Ownership transferred successfully" })
  } catch (error) {
    log.error({ err: error }, "Error transferring ownership:")
    return NextResponse.json({ error: "Failed to transfer ownership" }, { status: 500 })
  }
}
