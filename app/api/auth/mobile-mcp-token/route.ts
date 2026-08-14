/**
 * POST   /api/auth/mobile-mcp-token (legacy) — mint or return a 90-day token
 * DELETE /api/auth/mobile-mcp-token (legacy) — revoke all active mobile tokens
 *
 * The flow lives in lib/mobile-mcp-token.ts and is shared with the v1 route.
 * This handler owns only the response shape (no `meta` envelope). (Task e0613ae5.)
 */

import { capabilityGate } from "@/lib/brand/capabilities"
import { NextRequest, NextResponse } from "next/server"
import {
  resolveMobileSessionUser,
  mintOrReturnMobileToken,
  revokeMobileTokens,
} from "@/lib/mobile-mcp-token"
import { createLogger } from '@/lib/logger'

const log = createLogger('auth.mobile-mcp-token')

export async function POST(request: NextRequest) {
  try {
    // MCP off for this deployment means this endpoint does not exist —
    // before the session is read, so a disabled build cannot be probed
    // for cookie validity. (Task 3428a53c.)
    const blocked = capabilityGate('integrationMcp')
    if (blocked) return blocked

    const resolved = await resolveMobileSessionUser(request)
    if (!resolved.ok) {
      log.error(`[mobile-mcp-token] ${resolved.error}`)
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }

    const { token, userId } = await mintOrReturnMobileToken(resolved.userId)

    // `token` is plaintext — the only point at which it exists in that form.
    return NextResponse.json({ token, userId })
  } catch (error) {
    log.error({ err: error }, "Error generating mobile MCP token:")
    return NextResponse.json({ error: "Failed to generate token" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // MCP off for this deployment means this endpoint does not exist —
    // before the session is read, so a disabled build cannot be probed
    // for cookie validity. (Task 3428a53c.)
    const blocked = capabilityGate('integrationMcp')
    if (blocked) return blocked

    const resolved = await resolveMobileSessionUser(request)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }

    await revokeMobileTokens(resolved.userId)

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: error }, "Error revoking mobile MCP token:")
    return NextResponse.json({ error: "Failed to revoke token" }, { status: 500 })
  }
}
