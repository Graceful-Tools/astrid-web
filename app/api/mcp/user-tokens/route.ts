import { capabilityGate } from '@/lib/brand/capabilities'
import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { createLogger } from '@/lib/logger'
import { agentEmail } from '@/lib/brand/agent-emails'
import { mcpTokenLookup, mcpTokenStorageFields, resolveMCPPlaintext } from '@/lib/mcp-token'
import { generateMCPToken } from '@/lib/mcp-token-utils'
import { ensureAgentUser } from '@/lib/ai/ensure-agent-user'

const log = createLogger('mcp.user-tokens')


// Schema for creating user-level MCP access tokens
const CreateUserMCPTokenSchema = z.object({
  permissions: z.array(z.enum(["read", "write"])).min(1, "At least one permission required"),
  expiresInDays: z.number().min(1).max(365).optional(),
  description: z.string().optional(),
  agent: z.enum(["copilot"]).optional(),
})

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
    const validatedData = CreateUserMCPTokenSchema.parse(data)

    // Check if user has MCP enabled
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { mcpEnabled: true }
    })

    if (!user?.mcpEnabled) {
      return NextResponse.json(
        { error: "MCP access is disabled for your account" },
        { status: 403 }
      )
    }

    let agentUserId: string | null = null
    if (validatedData.agent) {
      const agentUser = await ensureAgentUser(agentEmail(validatedData.agent))
      if (!agentUser) {
        return NextResponse.json(
          { error: "The requested AI agent identity is not configured" },
          { status: 409 }
        )
      }
      agentUserId = agentUser.id
    }

    const token = generateMCPToken()

    // Calculate expiration date
    const expiresAt = validatedData.expiresInDays
      ? new Date(Date.now() + validatedData.expiresInDays * 24 * 60 * 60 * 1000)
      : null

    // Store token in database (user-level token has no listId)
    const mcpToken = await prisma.mCPToken.create({
      data: {
        ...mcpTokenStorageFields(token),
        listId: null, // User-level tokens have no specific list
        userId: session.user.id,
        agentUserId,
        agentMailbox: validatedData.agent ?? null,
        permissions: validatedData.permissions,
        expiresAt,
        description: validatedData.description,
        isActive: true
      }
    })

    return NextResponse.json({
      success: true,
      token,
      permissions: mcpToken.permissions,
      expiresAt: mcpToken.expiresAt,
      description: mcpToken.description,
      createdAt: mcpToken.createdAt,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.errors },
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