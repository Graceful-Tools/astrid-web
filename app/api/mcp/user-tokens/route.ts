import { capabilityGate } from '@/lib/brand/capabilities'
import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { createLogger } from '@/lib/logger'
import { mcpTokenLookup, resolveMCPPlaintext } from '@/lib/mcp-token'
import { MintAccessTokenSchema, mintAccessToken } from '@/lib/connections/mint-access-token'

const log = createLogger('mcp.user-tokens')

// POST shares its body, agent binding and refusals with
// POST /api/v1/users/me/access-tokens through mintAccessToken (AWTD-1312).

export async function GET() {
  const blocked = capabilityGate('integrationMcp')
  if (blocked) return blocked

  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get all user-level MCP tokens from database
    const userTokens = await prisma.mCPToken.findMany({
      where: {
        userId: session.user.id,
        listId: null, // User-level tokens have no specific list
        isActive: true
      },
      orderBy: { createdAt: 'desc' }
    })

    const formattedTokens = userTokens.map(token => ({
      token: resolveMCPPlaintext(token),
      permissions: token.permissions,
      expiresAt: token.expiresAt,
      description: token.description,
      createdAt: token.createdAt,
      isExpired: token.expiresAt ? new Date() > token.expiresAt : false,
    }))

    return NextResponse.json({ tokens: formattedTokens })
  } catch (error) {
    log.error({ err: error }, "Error fetching user MCP tokens:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const blocked = capabilityGate('integrationMcp')
  if (blocked) return blocked

  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data = await request.json()
    const validatedData = MintAccessTokenSchema.parse(data)

    const minted = await mintAccessToken(session.user.id, validatedData)
    if (!minted.ok) {
      return NextResponse.json({ error: minted.error }, { status: minted.status })
    }

    return NextResponse.json({
      success: true,
      token: minted.token,
      permissions: minted.permissions,
      expiresAt: minted.expiresAt,
      description: minted.description,
      createdAt: minted.createdAt,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      )
    }

    log.error({ err: error }, "Error creating user MCP token:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const blocked = capabilityGate('integrationMcp')
  if (blocked) return blocked

  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const token = searchParams.get("token")

    if (!token) {
      return NextResponse.json({ error: "Token parameter required" }, { status: 400 })
    }

    // Find and verify the token belongs to the user
    const mcpToken = await prisma.mCPToken.findFirst({
      where: {
        token: { in: mcpTokenLookup(token) },
        userId: session.user.id,
        listId: null // User-level tokens
      }
    })

    if (!mcpToken) {
      return NextResponse.json({ error: "Token not found" }, { status: 404 })
    }

    // Soft delete (mark as inactive) instead of hard delete for audit trail
    await prisma.mCPToken.update({
      where: { id: mcpToken.id },
      data: { isActive: false }
    })

    return NextResponse.json({ success: true, message: "Token revoked successfully" })
  } catch (error) {
    log.error({ err: error }, "Error deleting user MCP token:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}