import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { getPublicListPreview } from "@/lib/copy-utils"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('lists.[id].preview')


export async function GET(
  request: NextRequest,
  context: RouteContextParams<{ id: string }>
) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      )
    }

    const { id: listId } = await context.params

    log.info(`👀 Previewing public list ${listId} for user ${session.user.id}`)

    const listPreview = await getPublicListPreview(listId)

    if (!listPreview) {
      return NextResponse.json(
        { error: "Public list not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      list: listPreview
    })

  } catch (error) {
    log.error({ err: error }, "Error previewing public list:")
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
