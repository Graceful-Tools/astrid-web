/**
 * Validate an MCP access token against a target list and required permission.
 *
 * Every MCP tool call routes through this guard before doing real work. It
 * verifies (a) the token is active and unexpired, (b) the owning user still
 * has MCP enabled globally, (c) the token's stored permissions cover the
 * required operation, and (d) the user still has list access (ownership,
 * admin, or active member role).
 *
 * Throws on any failure — the surrounding switch/case in mcp-server-v2.ts
 * converts the thrown message into the MCP error envelope.
 *
 * Stateless and side-effect-free aside from the Prisma read; lives in its
 * own module so the legacy v2 server, future handler modules, and any
 * test harness can share one definition.
 */

const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function validateAccessToken(
  accessToken: string,
  listId: string,
  requiredPermission: "read" | "write" | "admin"
): Promise<{ userId: string; permissions: string[]; user: any; list: any }> {
  const mcpToken = await prisma.mcpToken.findFirst({
    where: {
      token: accessToken,
      listId,
      isActive: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    include: {
      user: {
        select: { id: true, name: true, email: true, mcpEnabled: true },
      },
      list: {
        include: {
          owner: { select: { id: true, name: true, email: true } },
          admins: { select: { id: true, name: true, email: true } },
          listMembers: {
            select: { userId: true, role: true, user: { select: { id: true, name: true, email: true } } },
          },
        },
      },
    },
  })

  if (!mcpToken) {
    throw new Error("Invalid or expired access token")
  }
  if (!mcpToken.user.mcpEnabled) {
    throw new Error("MCP access is disabled for this user")
  }

  const hasPermission =
    mcpToken.permissions.includes(requiredPermission) ||
    mcpToken.permissions.includes("admin")
  if (!hasPermission) {
    throw new Error(`Insufficient permissions. Required: ${requiredPermission}`)
  }

  // Re-check list access at validation time so a list membership revocation
  // takes effect immediately even if the token hasn't been rotated.
  const userHasListAccess =
    mcpToken.list.ownerId === mcpToken.user.id ||
    mcpToken.list.admins.some((admin: any) => admin.id === mcpToken.user.id) ||
    mcpToken.list.listMembers.some((member: any) =>
      member.userId === mcpToken.user.id &&
      ["admin", "member"].includes(member.role),
    )
  if (!userHasListAccess) {
    throw new Error("User no longer has access to this list")
  }

  return {
    userId: mcpToken.user.id,
    permissions: mcpToken.permissions,
    user: mcpToken.user,
    list: mcpToken.list,
  }
}

module.exports = { validateAccessToken }
export {}
