/**
 * Unified API Authentication Middleware
 *
 * Supports multiple authentication methods:
 * 1. OAuth tokens (preferred, new standard)
 * 2. Session cookies (web users)
 * 3. Legacy MCP tokens (deprecated, backward compatibility)
 */

import { BRAND } from '@/lib/brand/config'
import { type NextRequest } from 'next/server'
import { mcpTokenLookup } from "@/lib/mcp-token"
import { getServerSession } from 'next-auth'
import { authConfig } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'
import { validateAccessToken } from './oauth/oauth-token-manager'
import { hasRequiredScopes } from './oauth/oauth-scopes'
import { createLogger } from '@/lib/logger'
import { ensureAgentUser } from '@/lib/ai/ensure-agent-user'
import { agentEmail } from '@/lib/brand/agent-emails'

const log = createLogger('api-auth-middleware')


export type AuthSource = 'oauth' | 'session' | 'legacy_mcp'

export interface AuthContext {
  userId: string
  source: AuthSource
  scopes: string[]
  clientId?: string
  isAIAgent: boolean
  user: {
    id: string
    email: string
    name: string | null
    isAIAgent: boolean
  }
  agentUser?: {
    id: string
    email: string
    name: string | null
    isAIAgent: boolean
  } | null
}

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden - Insufficient permissions') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

/**
 * Extract OAuth token from request headers
 * Supports:
 * - Authorization: Bearer {token}
 * - X-OAuth-Token: {token}
 */
function extractOAuthToken(req: NextRequest): string | null {
  // Check Authorization header
  const authHeader = req.headers.get('authorization')
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim()
    if (token.startsWith('astrid_') && !token.startsWith('astrid_mcp_')) {
      return token
    }
  }

  // Check X-OAuth-Token header
  const oauthHeader = req.headers.get('x-oauth-token')
  if (oauthHeader && oauthHeader.startsWith('astrid_')) {
    return oauthHeader.trim()
  }

  return null
}

/**
 * Extract legacy MCP token from request headers
 * Supports:
 * - X-MCP-Access-Token: {token}
 * - Authorization: Bearer {token} (if starts with astrid_mcp_)
 */
function extractMCPToken(req: NextRequest): string | null {
  // Check X-MCP-Access-Token header
  const mcpHeader = req.headers.get('x-mcp-access-token')
  if (mcpHeader && mcpHeader.trim().length > 0) {
    return mcpHeader.trim()
  }

  // Check Authorization header for MCP token
  const authHeader = req.headers.get('authorization')
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim()
    if (token.startsWith('astrid_mcp_')) {
      return token
    }
  }

  return null
}

/**
 * Validate legacy MCP token
 */
async function validateMCPToken(token: string): Promise<{
  userId: string
  user: {
    id: string
    email: string
    name: string | null
    isAIAgent: boolean
  }
  agentUser: {
    id: string
    email: string
    name: string | null
    isAIAgent: boolean
  } | null
} | null> {
  const mcpToken = await prisma.mCPToken.findFirst({
    where: {
      token: { in: mcpTokenLookup(token) },
      isActive: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          isAIAgent: true,
        },
      },
      agentUser: {
        select: {
          id: true,
          email: true,
          name: true,
          isAIAgent: true,
        },
      },
    },
  })

  if (!mcpToken) {
    return null
  }

  let agentUser = mcpToken.agentUser
  if (!agentUser && mcpToken.agentMailbox === 'copilot') {
    const ensured = await ensureAgentUser(agentEmail('copilot'))
    if (ensured?.email) {
      agentUser = {
        id: ensured.id,
        email: ensured.email,
        name: ensured.name,
        isAIAgent: true,
      }
      await prisma.mCPToken.update({
        where: { id: mcpToken.id },
        data: { agentUserId: ensured.id },
      })
    }
  }

  return {
    userId: mcpToken.userId,
    user: mcpToken.user,
    agentUser,
  }
}

/**
 * Main authentication function
 * Tries multiple authentication methods in priority order
 *
 * @param req - The NextRequest object
 * @param legacyTokenFromBody - Optional token from request body (for iOS backward compatibility)
 */
export async function authenticateAPI(
  req: NextRequest,
  legacyTokenFromBody?: string
): Promise<AuthContext> {
  // Priority 1: OAuth token (new standard)
  const oauthToken = extractOAuthToken(req)
  if (oauthToken) {
    const validated = await validateAccessToken(oauthToken)
    if (validated) {
      return {
        userId: validated.userId,
        source: 'oauth',
        scopes: validated.scopes,
        clientId: validated.clientId,
        isAIAgent: validated.user.isAIAgent,
        user: validated.user,
      }
    }
  }

  // Priority 2: Session cookie (web users + iOS)
  // First try getServerSession (works for web)
  let session = await getServerSession(authConfig)

  // If no session found via getServerSession, check cookies directly (for iOS/mobile)
  if (!session?.user?.id && req.cookies) {
    const cookies = req.cookies
    const sessionCookie = cookies.get('next-auth.session-token') || cookies.get('__Secure-next-auth.session-token')

    if (sessionCookie) {
      const dbSession = await prisma.session.findUnique({
        where: { sessionToken: sessionCookie.value },
        include: { user: true },
      })

      if (dbSession && dbSession.expires > new Date()) {
        session = {
          user: {
            id: dbSession.user.id,
            email: dbSession.user.email,
            name: dbSession.user.name,
          },
          expires: dbSession.expires.toISOString(),
        }
      }
    }
  }

  if (session?.user?.id) {
    // Fetch full user details
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        isAIAgent: true,
      },
    })

    if (user) {
      return {
        userId: user.id,
        source: 'session',
        scopes: ['*'], // Full access for session users
        isAIAgent: user.isAIAgent,
        user,
      }
    }
  }

  // Priority 3: Legacy MCP token (deprecated, backward compatibility)
  // Check headers first, then fallback to body token (for iOS compatibility)
  const mcpToken = extractMCPToken(req) || legacyTokenFromBody
  if (mcpToken) {
    const validated = await validateMCPToken(mcpToken)
    if (validated) {
      log.warn('[API Auth] ⚠️ Legacy MCP token used - please migrate to OAuth')
      return {
        userId: validated.userId,
        source: 'legacy_mcp',
        scopes: ['*'], // Legacy tokens have full access
        isAIAgent: validated.user.isAIAgent,
        user: validated.user,
        agentUser: validated.agentUser,
      }
    }
  }

  throw new UnauthorizedError('No valid authentication found')
}

/**
 * Require specific scopes for an operation
 * @throws ForbiddenError if scopes are insufficient
 */
export function requireScopes(
  auth: AuthContext,
  requiredScopes: string[]
): void {
  if (!hasRequiredScopes(auth.scopes, requiredScopes)) {
    throw new ForbiddenError(
      `Missing required scopes: ${requiredScopes.join(', ')}`
    )
  }
}

/**
 * Get deprecation warning header for legacy auth methods
 */
export function getDeprecationWarning(auth: AuthContext): string | null {
  if (auth.source === 'legacy_mcp') {
    return `MCP tokens are deprecated. Please migrate to OAuth 2.0. See https://${BRAND.domain}/docs/api for migration guide.`
  }
  return null
}

/**
 * Helper to check if user has access to a specific list
 */
export async function requireListAccess(
  userId: string,
  listId: string,
  requiredRole: 'owner' | 'admin' | 'member' = 'member'
): Promise<void> {
  const list = await prisma.taskList.findFirst({
    where: {
      id: listId,
      OR: [
        { ownerId: userId },
        {
          listMembers: {
            some: {
              userId,
              ...(requiredRole !== 'member' && { role: requiredRole }),
            },
          },
        },
      ],
    },
  })

  if (!list) {
    throw new ForbiddenError('Access denied to this list')
  }
}

/**
 * The three ways a user is attached to a task: creator, assignee, or a member
 * (or owner) of one of its lists. Shared by the read and write checks below so
 * the two cannot drift apart on everything except the one difference between
 * them.
 */
function taskMembershipBranches(userId: string) {
  return [
    { creatorId: userId },
    { assigneeId: userId },
    {
      lists: {
        some: {
          OR: [
            { ownerId: userId },
            {
              listMembers: {
                some: { userId },
              },
            },
          ],
        },
      },
    },
  ]
}

/**
 * Helper to check if user has access to a specific task.
 *
 * This is the WRITE check — it guards PUT and DELETE. Do not add a PUBLIC-list
 * branch here: legacy's own PUT does not have one, and a stranger who can read
 * a task on a public list must not thereby be able to edit or delete it.
 * Reads use `requireTaskReadAccess`.
 */
export async function requireTaskAccess(
  userId: string,
  taskId: string
): Promise<void> {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      OR: taskMembershipBranches(userId),
    },
  })

  if (!task) {
    throw new ForbiddenError('Access denied to this task')
  }
}

/**
 * Helper to check if a user may READ a specific task.
 *
 * Same three membership routes as `requireTaskAccess`, plus the one legacy
 * `GET /api/tasks/[id]` has always allowed: any signed-in user may read a task
 * that sits on a PUBLIC list. Without this, v1 answered 403 where legacy
 * answered 200, which blocked moving the share-code landing page — and every
 * public share link with it — off the legacy route. (Task 92e582c6.)
 */
export async function requireTaskReadAccess(
  userId: string,
  taskId: string
): Promise<void> {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      OR: [
        ...taskMembershipBranches(userId),
        // Covers both public list types (copy-only and collaborative), which
        // is what legacy does.
        { lists: { some: { privacy: 'PUBLIC' } } },
      ],
    },
  })

  if (!task) {
    throw new ForbiddenError('Access denied to this task')
  }
}
