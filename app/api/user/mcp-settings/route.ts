import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { createLogger } from '@/lib/logger'

const log = createLogger('user.mcp-settings')


const UpdateUserMCPSettingsSchema = z.object({
  mcpEnabled: z.boolean().optional(),
  defaultNewListMcpEnabled: z.boolean().optional(),
  defaultNewListMcpAccessLevel: z.enum(['READ', 'write', 'both']).optional(),
})

export async function GET() {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        mcpEnabled: true,
        defaultNewListMcpEnabled: true,
        defaultNewListMcpAccessLevel: true
      }
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    return NextResponse.json({
      mcpEnabled: user.mcpEnabled,
      defaultNewListMcpEnabled: user.defaultNewListMcpEnabled,
      defaultNewListMcpAccessLevel: user.defaultNewListMcpAccessLevel
    })
  } catch (error) {
    log.error({ err: error }, "Error fetching user MCP settings:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data = await request.json()
    const validatedData = UpdateUserMCPSettingsSchema.parse(data)

    // Update user MCP settings (only update provided fields)
    const updateData: any = {}
    if (validatedData.mcpEnabled !== undefined) {
      updateData.mcpEnabled = validatedData.mcpEnabled
    }
    if (validatedData.defaultNewListMcpEnabled !== undefined) {
      updateData.defaultNewListMcpEnabled = validatedData.defaultNewListMcpEnabled
    }
    if (validatedData.defaultNewListMcpAccessLevel !== undefined) {
      updateData.defaultNewListMcpAccessLevel = validatedData.defaultNewListMcpAccessLevel.toUpperCase()
    }

    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: updateData,
      select: {
        mcpEnabled: true,
        defaultNewListMcpEnabled: true,
        defaultNewListMcpAccessLevel: true
      }
    })

    return NextResponse.json({
      success: true,
      mcpEnabled: updatedUser.mcpEnabled,
      defaultNewListMcpEnabled: updatedUser.defaultNewListMcpEnabled,
      defaultNewListMcpAccessLevel: updatedUser.defaultNewListMcpAccessLevel
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.errors },
        { status: 400 }
      )
    }

    log.error({ err: error }, "Error updating user MCP settings:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}