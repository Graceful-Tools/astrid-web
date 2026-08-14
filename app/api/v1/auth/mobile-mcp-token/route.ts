/**
 * POST   /api/v1/auth/mobile-mcp-token — mint or return existing 90-day token
 * DELETE /api/v1/auth/mobile-mcp-token — revoke all active mobile tokens
 *
 * Lets iOS swap session cookies for an MCP token (description "Mobile App
 * Token") so it can call MCP endpoints with token auth instead of cookies.
 *
 * The flow lives in lib/mobile-mcp-token.ts and is shared with the legacy
 * route. This handler owns only the v1 `meta` envelope. (Task e0613ae5.)
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  resolveMobileSessionUser,
  mintOrReturnMobileToken,
  revokeMobileTokens,
} from '@/lib/mobile-mcp-token'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.auth.mobile-mcp-token')

const META = { apiVersion: 'v1' as const, authSource: 'cookie' }

export async function POST(request: NextRequest) {
  try {
    const resolved = await resolveMobileSessionUser(request)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }

    const { token, userId } = await mintOrReturnMobileToken(resolved.userId)

    // `token` is plaintext — the only point at which it exists in that form.
    return NextResponse.json({ token, userId, meta: META })
  } catch (error) {
    log.error({ err: error }, 'Error generating mobile MCP token')
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const resolved = await resolveMobileSessionUser(request)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }

    await revokeMobileTokens(resolved.userId)

    return NextResponse.json({ success: true, meta: META })
  } catch (error) {
    log.error({ err: error }, 'Error revoking mobile MCP token')
    return NextResponse.json({ error: 'Failed to revoke token' }, { status: 500 })
  }
}
