/**
 * POST /api/lists/:id/invite (legacy) — invite someone to join a list.
 *
 * The flow lives in lib/list-invite.ts and is shared with the v1 route. This
 * handler owns only session auth and the response shape. (Task e0613ae5.)
 */

import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { inviteToList } from "@/lib/list-invite"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('lists.[id].invite')

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
    const { email, role, message } = await request.json()

    const result = await inviteToList({
      listId,
      inviter: {
        id: session.user.id,
        email: session.user.email!,
        name: session.user.name ?? null,
      },
      email,
      role,
      message,
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        {
          status: result.status,
          ...(result.retryAfterSeconds !== undefined && {
            headers: { 'Retry-After': String(result.retryAfterSeconds) },
          }),
        }
      )
    }

    return NextResponse.json({
      message: "Invitation sent successfully",
      invitation: result.invitation,
    })
  } catch (error) {
    log.error({ err: error }, "Error sending list invitation:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
