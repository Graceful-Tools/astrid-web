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
import { decode } from 'next-auth/jwt'
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
/**
 * Is this cookie a valid, unexpired NextAuth JWT?
 *
 * Used only to tell "signed in a way we do not support here" apart from
 * "not signed in", so the 401 can say which. A decode failure means the cookie
 * is neither a database session nor a readable JWT, which is the genuinely
 * invalid case.
 */
async function looksLikeValidJwtSession(cookieValue: string): Promise<boolean> {
  try {
    const decoded = await decode({
      token: cookieValue,
      secret: process.env.NEXTAUTH_SECRET!,
    })
    if (!decoded?.id) return false
    // An expired JWT is not "signed in with the wrong method", it is expired.
    if (typeof decoded.exp === 'number' && decoded.exp < Math.floor(Date.now() / 1000)) {
      return false
    }
    return true
  } catch {
    return false
  }
}

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
    // The cookie may be a perfectly valid JWT rather than a database session.
    // Passkey/WebAuthn sign-in issues JWTs (strategy: 'jwt'), Apple/Google
    // mobile sign-in issues database Session rows, and these routes only
    // understand the latter.
    //
    // Saying "invalid session" to a passkey user is actively misleading: they
    // ARE signed in, GET /api/v1/auth/mobile-session validates them, and the
    // message sends them looking for a broken integration instead of an
    // unsupported sign-in method. 33 authenticators are registered in
    // production, so this is a real audience. (Task c9a38b36.)
    //
    // This does NOT widen who can mint a token — deciding whether JWT sessions
    // should be accepted is a separate call. It only makes the refusal
    // truthful.
    if (await looksLikeValidJwtSession(sessionCookie.value)) {
      return {
        ok: false,
        status: 401,
        error:
          'Unauthorized - MCP tokens require an Apple or Google sign-in. ' +
          'Passkey sessions cannot mint one.',
      }
    }
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
