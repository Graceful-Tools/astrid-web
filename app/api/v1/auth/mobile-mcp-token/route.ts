/**
 * POST   /api/v1/auth/mobile-mcp-token — mint or return existing 90-day token
 * DELETE /api/v1/auth/mobile-mcp-token — revoke all active mobile tokens
 *
 * Lets iOS swap session cookies for an MCP token (description "Mobile App
 * Token") so it can call MCP endpoints with token auth instead of cookies.
 * Mirrors POST/DELETE /api/auth/mobile-mcp-token.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateMCPToken } from '@/lib/mcp-token-utils'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.auth.mobile-mcp-token')

const MOBILE_TOKEN_EXPIRY_DAYS = 90
const META = { apiVersion: 'v1' as const, authSource: 'cookie' }

async function resolveSessionUserId(request: NextRequest): Promise<
  { userId: string } | { errorResponse: NextResponse }
> {
  const cookies = request.cookies
  const sessionCookie =
    cookies.get('next-auth.session-token') ||
    cookies.get('__Secure-next-auth.session-token')

  if (!sessionCookie) {
    return { errorResponse: NextResponse.json({ error: 'Unauthorized - No session' }, { status: 401 }) }
  }

  const session = await prisma.session.findUnique({
    where: { sessionToken: sessionCookie.value },
    include: { user: true },
  })

  if (!session) {
    return { errorResponse: NextResponse.json({ error: 'Unauthorized - Invalid session' }, { status: 401 }) }
  }

  if (session.expires < new Date()) {
    await prisma.session.delete({ where: { id: session.id } })
    return { errorResponse: NextResponse.json({ error: 'Unauthorized - Session expired' }, { status: 401 }) }
  }

  return { userId: session.user.id }
}

export async function POST(request: NextRequest) {
  try {
    const resolved = await resolveSessionUserId(request)
    if ('errorResponse' in resolved) return resolved.errorResponse
    const { userId } = resolved

    const existingToken = await prisma.mCPToken.findFirst({
      where: {
        userId,
        description: 'Mobile App Token',
        isActive: true,
        listId: null,
        expiresAt: { gt: new Date() },
      },
    })

    if (existingToken) {
      return NextResponse.json({
        token: existingToken.token,
        userId: existingToken.userId,
        meta: META,
      })
    }

    const token = generateMCPToken()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + MOBILE_TOKEN_EXPIRY_DAYS)

    const mcpToken = await prisma.mCPToken.create({
      data: {
        token,
        userId,
        permissions: ['read', 'write'],
        description: 'Mobile App Token',
        isActive: true,
        expiresAt,
        listId: null,
      },
    })

    return NextResponse.json({
      token: mcpToken.token,
      userId: mcpToken.userId,
      meta: META,
    })
  } catch (error) {
    log.error({ err: error }, 'Error generating mobile MCP token')
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const resolved = await resolveSessionUserId(request)
    if ('errorResponse' in resolved) return resolved.errorResponse
    const { userId } = resolved

    await prisma.mCPToken.updateMany({
      where: {
        userId,
        description: 'Mobile App Token',
        isActive: true,
      },
      data: { isActive: false },
    })

    return NextResponse.json({ success: true, meta: META })
  } catch (error) {
    log.error({ err: error }, 'Error revoking mobile MCP token')
    return NextResponse.json({ error: 'Failed to revoke token' }, { status: 500 })
  }
}
