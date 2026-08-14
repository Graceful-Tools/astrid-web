/**
 * The mobile MCP token — mint-or-return, and revoke.
 *
 * iOS swaps its session cookie for an MCP token (description "Mobile App
 * Token") so it can call MCP endpoints with token auth instead of cookies.
 * Shared by `/api/auth/mobile-mcp-token` and its v1 twin; each route keeps its
 * own response shape (v1 adds `meta`).
 *
 * Collapsing these fixed a live drift. v1 had already factored the session
 * lookup into one helper used by both verbs; legacy still had two inline
 * copies, and they had diverged — POST checked `session.expires` and deleted
 * the expired row, DELETE did not, so an expired session cookie could still
 * revoke a user's mobile tokens. One resolver means one answer to "is this
 * caller signed in". (Task e0613ae5.)
 */

import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { mcpTokenStorageFields, resolveMCPPlaintext } from '@/lib/mcp-token'
import { generateMCPToken } from '@/lib/mcp-token-utils'

const MOBILE_TOKEN_EXPIRY_DAYS = 90
const MOBILE_TOKEN_DESCRIPTION = 'Mobile App Token'

export type SessionResolution =
  | { ok: true; userId: string }
  | { ok: false; status: 401; error: string }

/**
 * Resolve the caller from the NextAuth session cookie.
 *
 * Deliberately reads the cookie directly rather than going through
 * getUnifiedSession: these routes exist to bootstrap token auth for a client
 * that only has a cookie, so the cookie is the whole input.
 */
export async function resolveMobileSessionUser(request: NextRequest): Promise<SessionResolution> {
  const sessionCookie =
    request.cookies.get('next-auth.session-token') ||
    request.cookies.get('__Secure-next-auth.session-token')

  if (!sessionCookie) {
    return { ok: false, status: 401, error: 'Unauthorized - No session' }
  }

  const session = await prisma.session.findUnique({
    where: { sessionToken: sessionCookie.value },
    include: { user: true },
  })

  if (!session) {
    return { ok: false, status: 401, error: 'Unauthorized - Invalid session' }
  }

  if (session.expires < new Date()) {
    await prisma.session.delete({ where: { id: session.id } })
    return { ok: false, status: 401, error: 'Unauthorized - Session expired' }
  }

  return { ok: true, userId: session.user.id }
}

/**
 * Return the caller's live mobile token, or mint a fresh 90-day one.
 *
 * The returned `token` is plaintext and is the only time it exists in that
 * form — storage is hashed and encrypted (see lib/mcp-token).
 *
 * `token` is `string | null` because resolveMCPPlaintext can fail to recover
 * one: a row written during the hash-only phase, before the encryption
 * backfill, has no `tokenEncrypted` and a `token` column that is already a
 * hash. Both routes have always passed that null straight to the client — the
 * looseness was hidden by untyped JSON, not intended — so this preserves it
 * rather than changing behaviour inside a refactor. Filed separately.
 */
export async function mintOrReturnMobileToken(
  userId: string,
): Promise<{ token: string | null; userId: string }> {
  const existingToken = await prisma.mCPToken.findFirst({
    where: {
      userId,
      description: MOBILE_TOKEN_DESCRIPTION,
      isActive: true,
      listId: null, // user-level, not scoped to a list
      expiresAt: { gt: new Date() },
    },
  })

  if (existingToken) {
    return { token: resolveMCPPlaintext(existingToken), userId: existingToken.userId }
  }

  const token = generateMCPToken()
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + MOBILE_TOKEN_EXPIRY_DAYS)

  const mcpToken = await prisma.mCPToken.create({
    data: {
      ...mcpTokenStorageFields(token),
      userId,
      permissions: ['read', 'write'], // the user's own data only
      description: MOBILE_TOKEN_DESCRIPTION,
      isActive: true,
      expiresAt,
      listId: null,
    },
  })

  return { token, userId: mcpToken.userId }
}

/** Deactivate every active mobile token for the user — used on sign-out. */
export async function revokeMobileTokens(userId: string): Promise<void> {
  await prisma.mCPToken.updateMany({
    where: { userId, description: MOBILE_TOKEN_DESCRIPTION, isActive: true },
    data: { isActive: false },
  })
}
