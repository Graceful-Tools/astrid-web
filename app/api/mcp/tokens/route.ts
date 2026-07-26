import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { randomBytes } from "crypto"
import { createLogger } from '@/lib/logger'
import { canUserManageList } from "@/lib/list-permissions"

const log = createLogger('mcp.tokens')


// Schema for creating MCP access tokens
const CreateMCPTokenSchema = z.object({
  listId: z.string().min(1, "List ID is required"),
  permissions: z.array(z.enum(["read", "write", "admin"])).min(1, "At least one permission required"),
  expiresInDays: z.number().min(1).max(365).optional(),
  description: z.string().optional(),
})

export async function GET() {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get all MCP tokens for this user's lists from database
    const userTokens = await prisma.mCPToken.findMany({
      where: {
        list: {
          OR: [
            { ownerId: session.user.id },
            { listMembers: { some: { userId: session.user.id } } },
            { listMembers: { some: { userId: session.user.id, role: "admin" } } },
          ],
        },
        isActive: true
      },
      include: {
        list: {
          select: { id: true, name: true, mcpEnabled: true, mcpAccessLevel: true }
        },
        user: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    const formattedTokens = userTokens.map(token => ({
      token: token.token,
      listId: token.listId,
      listName: token.list?.name || 'Unknown List',
      permissions: token.permissions,
      expiresAt: token.expiresAt,
      description: token.description,
      createdAt: token.createdAt,
      isExpired: token.expiresAt ? new Date() > token.expiresAt : false,
      mcpEnabled: token.list?.mcpEnabled || false,
      mcpAccessLevel: token.list?.mcpAccessLevel || 'WRITE'
    }))

    return NextResponse.json({ tokens: formattedTokens })
  } catch (error) {
    log.error({ err: error }, "Error fetching MCP tokens:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data = await request.json()
    const validatedData = CreateMCPTokenSchema.parse(data)

    // Verify user has permission to create tokens for this list
    const list = await prisma.taskList.findFirst({
      where: {
        id: validatedData.listId,
        OR: [
          { ownerId: session.user.id },
          { listMembers: { some: { userId: session.user.id } } },
          { listMembers: { some: { userId: session.user.id, role: "admin" } } },
        ],
      },
      include: {
        owner: {
          select: { id: true, name: true, email: true },
        },
      },
    })

    if (!list) {
      return NextResponse.json(
        { error: "List not found or insufficient permissions" },
        { status: 404 }
      )
    }

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

    // Generate secure token
    const token = `astrid_mcp_${randomBytes(32).toString('hex')}`

    // Calculate expiration date
    const expiresAt = validatedData.expiresInDays
      ? new Date(Date.now() + validatedData.expiresInDays * 24 * 60 * 60 * 1000)
      : null

    // Store token in database
    const mcpToken = await prisma.mCPToken.create({
      data: {
        token,
        listId: validatedData.listId,
        userId: session.user.id,
        permissions: validatedData.permissions,
        expiresAt,
        description: validatedData.description,
        isActive: true
      },
      include: {
        list: {
          select: { id: true, name: true, mcpEnabled: true, mcpAccessLevel: true }
        }
      }
    })

    return NextResponse.json({
      success: true,
      token: mcpToken.token,
      listId: mcpToken.listId,
      listName: mcpToken.list?.name || 'Unknown List',
      permissions: mcpToken.permissions,
      expiresAt: mcpToken.expiresAt,
      description: mcpToken.description,
      createdAt: mcpToken.createdAt,
      mcpEnabled: mcpToken.list?.mcpEnabled || false,
      mcpAccessLevel: mcpToken.list?.mcpAccessLevel || 'WRITE'
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.errors },
        { status: 400 }
      )
    }

    log.error({ err: error }, "Error creating MCP token:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
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

    // Find the token and verify permissions
    const mcpToken = await prisma.mCPToken.findFirst({
      where: { token },
      include: {
        list: {
          include: {
            owner: true,
            listMembers: true
          }
        }
      }
    })

    if (!mcpToken) {
      return NextResponse.json({ error: "Token not found" }, { status: 404 })
    }

    // Verify user has permission to delete this token
    const userCanDelete = !!mcpToken.list &&
      canUserManageList({ id: session.user.id }, mcpToken.list as never)

    if (!userCanDelete) {
      return NextResponse.json(
        { error: "Insufficient permissions to delete this token" },
        { status: 403 }
      )
    }

    // Soft delete (mark as inactive) instead of hard delete for audit trail
    await prisma.mCPToken.update({
      where: { id: mcpToken.id },
      data: { isActive: false }
    })

    return NextResponse.json({ success: true, message: "Token revoked successfully" })
  } catch (error) {
    log.error({ err: error }, "Error deleting MCP token:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}