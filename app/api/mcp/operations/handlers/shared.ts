/**
 * Shared utilities for MCP operation handlers
 */

import { prisma } from "@/lib/prisma"
import { getListMemberIds } from "@/lib/list-member-utils"
import { getUserRoleInList } from "@/lib/list-permissions"

/**
 * Mask a token for logging (show first 4 and last 4 chars)
 */
export function maskToken(token: string): string {
  if (!token) {
    return ''
  }
  const trimmed = token.trim()
  if (trimmed.length <= 8) {
    return '****'
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`
}

/**
 * Redact sensitive data from args for logging
 */
export function redactArgsForLogging(args: any) {
  if (!args || typeof args !== "object") {
    return args
  }
  const cloned = { ...args }
  if (cloned.accessToken) {
    cloned.accessToken = maskToken(String(cloned.accessToken))
  }
  return cloned
}

/**
 * Get member IDs for a list by ID
 */
export async function getListMemberIdsByListId(listId: string): Promise<string[]> {
  const list = await prisma.taskList.findFirst({
    where: { id: listId },
    include: {
      listMembers: {
        include: {
          user: true
        }
      }
    }
  })

  if (!list) return []

  // Use the centralized utility to get all members
  return getListMemberIds(list)
}

/**
 * Determine MCP access level from token permissions
 */
export function getTokenAccessLevel(tokenPermissions: string[]): 'READ' | 'WRITE' | 'BOTH' {
  if (tokenPermissions.includes('admin') || tokenPermissions.includes('write')) {
    return 'BOTH'
  }
  return 'READ'
}

/**
 * Validate an MCP token and return the token record with user and list info.
 *
 * The guard below is load-bearing (task 13f43055). `accessToken` is optional on
 * every MCP operation — the route also accepts a session cookie and an OAuth
 * bearer — so this was routinely reached with `undefined`. Prisma DROPS an
 * `undefined` filter, which turned the query into "any active MCP token" and
 * returned the first row in the table, belonging to an unrelated user. The
 * caller was then authorized as that stranger. An absent token must fail here;
 * callers who legitimately have no token go through `resolveMCPActor`.
 */
export async function validateMCPToken(token: string, listId?: string) {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new Error('MCP_TOKEN_INVALID: No MCP access token was presented.')
  }

  const mcpToken = await prisma.mCPToken.findFirst({
    where: {
      token,
      isActive: true,
      OR: [
        { listId: listId },
        { listId: null } // User-level tokens
      ],
      // Check token hasn't expired
      AND: [
        {
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } }
          ]
        }
      ]
    },
    include: {
      user: {
        select: { id: true, name: true, email: true }
      },
      list: {
        include: {
          listMembers: true
        }
      }
    }
  })

  if (!mcpToken) {
    throw new Error('MCP_TOKEN_INVALID: No valid MCP access token found. Please create an MCP access token in Settings -> AI Agent Access first.')
  }

  return mcpToken
}

/**
 * Who an MCP operation runs as.
 *
 * Two legitimate ways to reach these handlers, and they resolve identity
 * differently:
 *
 * - **An MCP token was presented.** It is a bearer credential, so acting as its
 *   owner is correct by design, and the token also carries its own list scope
 *   and permissions. Unchanged behaviour.
 * - **No token.** The caller authenticated with a session cookie or an OAuth
 *   bearer, and `authenticateAPI` has already resolved exactly who they are.
 *   Use that. Before task 13f43055 the handlers instead asked the database for
 *   a token that was never presented and got somebody else's.
 */
export interface MCPActor {
  userId: string
  user: { id: string; name: string | null; email: string }
  /** The token record when one was presented; null for session/OAuth callers. */
  token: Awaited<ReturnType<typeof validateMCPToken>> | null
}

export async function resolveMCPActor(
  accessToken: string | null | undefined,
  authenticatedUserId: string | undefined,
  listId?: string,
): Promise<MCPActor> {
  if (typeof accessToken === 'string' && accessToken.trim() !== '') {
    const token = await validateMCPToken(accessToken, listId)
    return { userId: token.userId, user: token.user, token }
  }

  // Neither a token nor a resolved identity: refuse. `removeListMember` types
  // its trailing `userId` as optional even though the route always passes
  // `auth.userId`, and "no identity" must not fall through to a lookup that
  // could match somebody.
  if (!authenticatedUserId) {
    throw new Error('MCP_TOKEN_INVALID: No MCP access token and no authenticated user.')
  }

  const user = await prisma.user.findUnique({
    where: { id: authenticatedUserId },
    select: { id: true, name: true, email: true },
  })

  if (!user) {
    throw new Error('MCP_TOKEN_INVALID: No authenticated user for this request.')
  }

  return { userId: user.id, user, token: null }
}

/**
 * Interface for list permission checks
 */
export interface ListForPermissions {
  ownerId: string
  listMembers?: Array<{ userId: string; role: string }> | null
}

/**
 * Determine permissions for a user on a list
 */
export function determinePermissions(list: ListForPermissions, userId: string): string[] {
  const permissions = ['read']

  // Role -> permissions, off the canonical lookup rather than re-deriving it
  // here (task e2803305). getUserRoleInList also honours the owner relation and
  // the legacy admins[]/members[] arrays, and is case-insensitive on role.
  const role = getUserRoleInList({ id: userId }, list as never)
  if (role === 'owner' || role === 'admin') {
    permissions.push('write', 'admin')
  } else if (role === 'member') {
    permissions.push('write')
  }

  return permissions
}
