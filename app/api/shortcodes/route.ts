/**
 * POST /api/shortcodes (legacy) — create a share link for a task or list
 * GET  /api/shortcodes (legacy) — list share links for a target
 *
 * The access rule lives in lib/shortcode-target-access.ts and is shared with
 * the v1 route. It used to be written out twice in this file alone — once per
 * handler — and a third time in v1. (Task e0613ae5.)
 */

import { BRAND } from '@/lib/brand/config'
import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { createShortcode, getShortcodesForTarget, buildShortcodeUrl } from "@/lib/shortcode"
import { checkShortcodeTargetAccess, type ShortcodeTargetType } from "@/lib/shortcode-target-access"
import { createLogger } from '@/lib/logger'

const log = createLogger('shortcodes')

/**
 * Build the share URL from the request's own Host rather than the configured
 * base URL. Kept as-is: it is what makes links generated on localhost and on
 * preview deploys point back at the host you are actually using. The v1 route
 * deliberately does not do this — see the note on that file.
 */
function requestBaseUrl(request: NextRequest): string {
  const host = request.headers.get("host") || `${BRAND.domain}`
  const protocol = host.includes("localhost") ? "http" : "https"
  return `${protocol}://${host}`
}

export async function POST(request: NextRequest) {
  try {
    const session = await getUnifiedSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const baseUrl = requestBaseUrl(request)

    const body = await request.json()
    const { targetType, targetId, expiresAt } = body

    const access = await checkShortcodeTargetAccess(targetType, targetId, session.user.id)
    if (!access.ok) {
      return NextResponse.json({ error: access.message }, { status: access.status })
    }

    const shortcode = await createShortcode({
      targetType: targetType as ShortcodeTargetType,
      targetId,
      userId: session.user.id,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined
    })

    return NextResponse.json({
      shortcode,
      url: buildShortcodeUrl(shortcode.code, baseUrl)
    })
  } catch (error) {
    log.error({ err: error }, "Error creating shortcode:")
    return NextResponse.json(
      { error: "Failed to create shortcode" },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getUnifiedSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const baseUrl = requestBaseUrl(request)

    const { searchParams } = new URL(request.url)
    const targetType = searchParams.get("targetType")
    const targetId = searchParams.get("targetId")

    const access = await checkShortcodeTargetAccess(targetType, targetId, session.user.id)
    if (!access.ok) {
      return NextResponse.json({ error: access.message }, { status: access.status })
    }

    const shortcodes = await getShortcodesForTarget(
      targetType as ShortcodeTargetType,
      targetId as string
    )

    return NextResponse.json({
      shortcodes: shortcodes.map((sc) => ({
        ...sc,
        url: buildShortcodeUrl(sc.code, baseUrl)
      }))
    })
  } catch (error) {
    log.error({ err: error }, "Error fetching shortcodes:")
    return NextResponse.json(
      { error: "Failed to fetch shortcodes" },
      { status: 500 }
    )
  }
}
