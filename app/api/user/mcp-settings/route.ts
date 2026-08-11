/**
 * User MCP Settings API — **no v1 successor, by design** (task 641a7615, decision 3A).
 *
 * The other four legacy `/api/user/*` routes without a v1 twin got one. This
 * one did not, because nothing calls it: zero call sites in this repo and zero
 * in astrid-ios, on any file type. Building a v1 twin would mean maintaining
 * two paths to a surface with no users.
 *
 * The three columns it writes are not equally dead, which is worth recording
 * before someone deletes them along with the route:
 *
 * - `mcpEnabled` IS read — it gates MCP token minting in `/api/mcp/tokens` and
 *   `/api/mcp/user-tokens`. It defaults to `true`, so the gate is open for
 *   everyone and this endpoint is a pure opt-out that no UI ever offers. The
 *   column stays; the endpoint is what has no users.
 * - `defaultNewListMcpEnabled` / `defaultNewListMcpAccessLevel` are read by
 *   nothing at all. List creation does not consult them, so the stored
 *   preference has never been applied. Whether it should be is a product
 *   question, not a cleanup — it is flagged on 641a7615 rather than guessed at.
 *
 * Retirement plan: leave it live and counted, let the deprecation census prove
 * zero traffic through the sunset date in lib/api-deprecation.ts, then delete
 * it with the rest of the legacy prefix. Do not build a v1 twin for it.
 */

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