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
 * Validate an MCP token and return the token record with user and list info
 */
export async function validateMCPToken(token: string, listId?: string) {
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
