import { NextRequest, NextResponse } from "next/server"
import { mcpTokenStorageFields, resolveMCPPlaintext } from "@/lib/mcp-token"
import { prisma } from "@/lib/prisma"
import { generateMCPToken } from "@/lib/mcp-token-utils"
import { createLogger } from '@/lib/logger'

const log = createLogger('auth.mobile-mcp-token')


// Mobile token expires after 90 days
const MOBILE_TOKEN_EXPIRY_DAYS = 90

/**
 * Generate or retrieve MCP token for mobile app authentication
 * This allows mobile clients to use the MCP API with token-based auth
 * instead of session cookies
 */
export async function POST(request: NextRequest) {
  try {
    // Get session token from cookie (same as mobile-session endpoint)
    const cookies = request.cookies
    const sessionCookie = cookies.get("next-auth.session-token") || cookies.get("__Secure-next-auth.session-token")

    if (!sessionCookie) {
      log.error("[mobile-mcp-token] Authentication failed: no session cookie")
      return NextResponse.json(
        { error: "Unauthorized - No session" },
        { status: 401 }
      )
    }

    // Find session
    const session = await prisma.session.findUnique({
      where: { sessionToken: sessionCookie.value },
      include: { user: true },
    })

    if (!session) {
      log.error("[mobile-mcp-token] Invalid session token")
      return NextResponse.json(
        { error: "Unauthorized - Invalid session" },
        { status: 401 }
      )
    }

    // Check if session is expired
    if (session.expires < new Date()) {
      log.error("[mobile-mcp-token] Session expired")
      await prisma.session.delete({
        where: { id: session.id },
      })
      return NextResponse.json(
        { error: "Unauthorized - Session expired" },
        { status: 401 }
      )
    }

    const userId = session.user.id

    // Check if user already has an active, non-expired mobile MCP token
    const existingToken = await prisma.mCPToken.findFirst({
      where: {
        userId,
        description: "Mobile App Token",
        isActive: true,
        listId: null, // User-level token, not list-specific
        expiresAt: { gt: new Date() }
      }
    })

    if (existingToken) {
      return NextResponse.json({
        token: resolveMCPPlaintext(existingToken),
        userId: existingToken.userId
      })
    }

    // Generate new mobile MCP token with expiration
    const token = generateMCPToken()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + MOBILE_TOKEN_EXPIRY_DAYS)

    const mcpToken = await prisma.mCPToken.create({
      data: {
        ...mcpTokenStorageFields(token),
        userId,
        permissions: ["read", "write"], // Full permissions for user's own data
        description: "Mobile App Token",
        isActive: true,
        expiresAt, // Token expires after 90 days
        listId: null // User-level token
      }
    })

    return NextResponse.json({
      token, // plaintext (stored hashed + encrypted)
      userId: mcpToken.userId
    })

  } catch (error) {
    log.error({ err: error }, "Error generating mobile MCP token:")
    return NextResponse.json(
      { error: "Failed to generate token" },
      { status: 500 }
    )
  }
}

/**
 * Revoke mobile MCP token (for sign out)
 */
export async function DELETE(request: NextRequest) {
  try {
    // Get session token from cookie
    const cookies = request.cookies
    const sessionCookie = cookies.get("next-auth.session-token") || cookies.get("__Secure-next-auth.session-token")

    if (!sessionCookie) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    // Find session
    const session = await prisma.session.findUnique({
      where: { sessionToken: sessionCookie.value },
      include: { user: true },
    })

    if (!session || !session.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const userId = session.user.id

    // Deactivate all mobile tokens for this user
    await prisma.mCPToken.updateMany({
      where: {
        userId,
        description: "Mobile App Token",
        isActive: true
      },
      data: {
        isActive: false
      }
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    log.error({ err: error }, "Error revoking mobile MCP token:")
    return NextResponse.json(
      { error: "Failed to revoke token" },
      { status: 500 }
    )
  }
}
