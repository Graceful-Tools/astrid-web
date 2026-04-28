import { NextRequest, NextResponse } from "next/server"
import { resolveShortcode } from "@/lib/shortcode"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('shortcodes.[code]')


/**
 * GET /api/shortcodes/[code]
 * Resolve a shortcode to its target
 */
export async function GET(
  request: NextRequest,
  context: RouteContextParams<{ code: string }>
) {
  try {
    const { code } = await context.params

    if (!code) {
      return NextResponse.json({ error: "Code is required" }, { status: 400 })
    }

    const result = await resolveShortcode(code)

    if (!result) {
      return NextResponse.json(
        { error: "Shortcode not found or expired" },
        { status: 404 }
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    log.error({ err: error }, "Error resolving shortcode:")
    return NextResponse.json(
      { error: "Failed to resolve shortcode" },
      { status: 500 }
    )
  }
}
