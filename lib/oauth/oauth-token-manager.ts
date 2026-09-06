/**
 * OAuth Token Manager
 *
 * Handles generation, validation, and lifecycle management of OAuth tokens.
 * Supports multiple OAuth 2.0 flows:
 * - Client Credentials
 * - Authorization Code
 * - Refresh Token
 */

import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import { type OAuthScope, validateScopes, hasRequiredScopes } from './oauth-scopes'
import { createLogger } from '@/lib/logger'
import { ensureAgentUser } from '@/lib/ai/ensure-agent-user'
import { agentEmail } from '@/lib/brand/agent-emails'
import { normalizeStoredAgentMailbox, type ConsentAgentMailbox } from './agent-consent'

const log = createLogger('oauth.oauth-token-manager')


const TOKEN_LENGTHS = {
  ACCESS_TOKEN: 64, // bytes (128 hex chars)
  REFRESH_TOKEN: 64,
  AUTHORIZATION_CODE: 32,
} as const

const TOKEN_LIFETIMES = {
  ACCESS_TOKEN: 60 * 60, // 1 hour in seconds
  REFRESH_TOKEN: 60 * 60 * 24 * 30, // 30 days in seconds
  AUTHORIZATION_CODE: 10 * 60, // 10 minutes in seconds
} as const

/**
 * Generate cryptographically secure random token
 */
function generateSecureToken(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex')
}

/**
 * Hash client secret for storage
 */
export function hashClientSecret(secret: string): string {
  return crypto
    .createHash('sha256')
    .update(secret)
    .digest('hex')
}

/**
 * Hash a bearer/refresh token for storage + lookup. Tokens are 32+ random
 * bytes (high entropy), so an unsalted SHA-256 is adequate and lets us look
 * up by hash. A DB/backup leak no longer yields usable bearer credentials.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * Dual-read lookup filter for a presented OAuth credential (access token,
 * refresh token or authorization code).
 *
 * The prefix guard is the security property (task 0845cf1c). These lookups used
 * to be `{ in: [hashToken(presented), presented] }`, whose second branch
 * matches the STORED value verbatim — so anyone able to read the table could
 * present the stored hash itself as a bearer token and be authenticated,
 * defeating the hashing entirely.
 *
 * Every real credential is prefixed (`astrid_`, `astrid_refresh_`,
 * `astrid_code_`) and a stored hash is bare hex, so legacy un-backfilled rows
 * keep working without a hash ever being accepted.
 */
export function oauthTokenLookup(presented: string): string[] {
  const filters = [hashToken(presented)]
  if (presented.startsWith('astrid_')) {
    filters.push(presented)
  }
  return filters
}

/**
 * Verify client secret against hash
 */
export function verifyClientSecret(secret: string, hash: string): boolean {
  const secretHash = hashClientSecret(secret)
  return crypto.timingSafeEqual(
    Buffer.from(secretHash),
    Buffer.from(hash)
  )
}

export function verifyCodeChallenge(
  verifier: string,
  challenge: string,
  method: string,
): boolean {
  if (method !== 'S256' || verifier.length < 43 || verifier.length > 128) {
    return false
  }
  const actual = crypto.createHash('sha256').update(verifier).digest('base64url')
  const expected = Buffer.from(challenge)
  const candidate = Buffer.from(actual)
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate)
}

/**
 * Generate access token for client credentials flow
 */
export async function generateAccessToken(
  clientId: string,
  userId: string,
  scopes: string[]
): Promise<{
  accessToken: string
  tokenType: string
  expiresIn: number
  scope: string
}> {
  const validScopes = validateScopes(scopes)
  const accessToken = `astrid_${generateSecureToken(TOKEN_LENGTHS.ACCESS_TOKEN)}`
  const expiresAt = new Date(Date.now() + TOKEN_LIFETIMES.ACCESS_TOKEN * 1000)

  await prisma.oAuthToken.create({
    data: {
      accessToken: hashToken(accessToken), // stored hashed; plaintext returned to caller
      tokenType: 'Bearer',
      clientId,
      userId,
      scopes: validScopes,
      expiresAt,
      refreshToken: null, // Client credentials flow doesn't issue refresh tokens
    },
  })

  return {
    accessToken,
    tokenType: 'Bearer',
    expiresIn: TOKEN_LIFETIMES.ACCESS_TOKEN,
    scope: validScopes.join(' '),
  }
}

/**
 * Generate access + refresh token for authorization code flow
 */
export async function generateAccessAndRefreshToken(
  clientId: string,
  userId: string,
  scopes: string[],
  agentMailbox?: ConsentAgentMailbox,
): Promise<{
  accessToken: string
  refreshToken: string
  tokenType: string
  expiresIn: number
  scope: string
}> {
  const validScopes = validateScopes(scopes)
  const accessToken = `astrid_${generateSecureToken(TOKEN_LENGTHS.ACCESS_TOKEN)}`
  const refreshToken = `astrid_refresh_${generateSecureToken(TOKEN_LENGTHS.REFRESH_TOKEN)}`
  const accessExpiresAt = new Date(Date.now() + TOKEN_LIFETIMES.ACCESS_TOKEN * 1000)
  const refreshExpiresAt = new Date(Date.now() + TOKEN_LIFETIMES.REFRESH_TOKEN * 1000)

  await prisma.oAuthToken.create({
    data: {
      accessToken: hashToken(accessToken),   // stored hashed
      refreshToken: hashToken(refreshToken), // stored hashed
      tokenType: 'Bearer',
      clientId,
      userId,
      scopes: validScopes,
      agentMailbox: agentMailbox ?? null,
      expiresAt: accessExpiresAt,
      refreshExpiresAt,
    },
  })

  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: TOKEN_LIFETIMES.ACCESS_TOKEN,
    scope: validScopes.join(' '),
  }
}

/**
 * Refresh an access token using a refresh token
 */
export async function refreshAccessToken(
  refreshToken: string,
  clientId: string
): Promise<{
  accessToken: string
  refreshToken: string
  tokenType: string
  expiresIn: number
  scope: string
} | null> {
  // Find and validate refresh token
  const existingToken = await prisma.oAuthToken.findFirst({
    where: {
      refreshToken: { in: oauthTokenLookup(refreshToken) },
      clientId,
      revokedAt: null,
      refreshExpiresAt: {
        gt: new Date(),
      },
    },
  })

  if (!existingToken) {
    return null
  }

  // Fail closed rather than refreshing an agent-consented token into a plain
  // user token — the client would keep working while quietly losing its authorship.
  const refreshMailbox = normalizeStoredAgentMailbox(existingToken.agentMailbox)
  if (existingToken.agentMailbox && !refreshMailbox) {
    log.error(
      { tokenId: existingToken.id, agentMailbox: existingToken.agentMailbox },
      'Refresh token carries an agent identity this deployment cannot resolve',
    )
    return null
  }

  // Revoke old token
  await prisma.oAuthToken.update({
    where: { id: existingToken.id },
    data: { revokedAt: new Date() },
  })

  // Generate new token pair
  return await generateAccessAndRefreshToken(
    clientId,
    existingToken.userId,
    existingToken.scopes,
    refreshMailbox,
  )
}

/**
 * How often a client's lastUsedAt is actually written.
 *
 * Per-instance, so with N warm instances the true rate is N writes per
 * interval — still three orders of magnitude below one per request, and this
 * is telemetry: an approximate "last seen" is the whole requirement.
 */
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000
const lastUsedWrittenAt = new Map<string, number>()

function shouldRecordClientUse(clientId: string, now = Date.now()): boolean {
  const previous = lastUsedWrittenAt.get(clientId)
  if (previous !== undefined && now - previous < LAST_USED_WRITE_INTERVAL_MS) {
    return false
  }
  lastUsedWrittenAt.set(clientId, now)
  return true
}

/**
 * Validate an access token and return token info
 */
export async function validateAccessToken(
  token: string
): Promise<{
  userId: string
  clientId: string
  scopes: string[]
  user: {
    id: string
    email: string
    isAIAgent: boolean
    name: string | null
  }
  agentUser: {
    id: string
    email: string
    isAIAgent: boolean
    name: string | null
  } | null
} | null> {
  log.debug({
    tokenFp: hashToken(token).slice(0, 12), // fingerprint, not the token itself
  }, '[OAuth] validateAccessToken called:')

  const oauthToken = await prisma.oAuthToken.findFirst({
    where: {
      accessToken: { in: oauthTokenLookup(token) },
      expiresAt: {
        gt: new Date(),
      },
      revokedAt: null,
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          isAIAgent: true,
          name: true,
        },
      },
    },
  })

  if (!oauthToken) {
    // WARN, and once — this is the only line a rejected request produces, and
    // it is what makes a recurring 401 identifiable instead of another
    // investigation (task 2e15b42f).
    log.warn(
      { tokenFp: hashToken(token).slice(0, 12) },
      '[OAuth] Access token rejected: not found, expired or revoked'
    )

    // The "why" probe is a SECOND database query, and it used to run on every
    // rejection — so one client polling with a stale token cost two queries a
    // minute, forever. Debug only.
    if (log.isLevelEnabled('debug')) {
      const anyToken = await prisma.oAuthToken.findFirst({
        where: { accessToken: { in: oauthTokenLookup(token) } },
        select: { id: true, expiresAt: true, revokedAt: true },
      })
      log.debug(
        { anyToken: anyToken ?? null },
        anyToken ? '[OAuth] Token exists but is invalid' : '[OAuth] Token does not exist'
      )
    }
    return null
  }

  log.debug({ userId: oauthToken.userId }, '[OAuth] Token validated successfully for user')

  // Fail closed: a token minted with agent consent that can no longer resolve its
  // identity must not silently fall back to authoring as the human who granted it.
  let agentUser = null
  if (oauthToken.agentMailbox) {
    const mailbox = normalizeStoredAgentMailbox(oauthToken.agentMailbox)
    const ensured = mailbox ? await ensureAgentUser(agentEmail(mailbox)) : null
    if (!ensured?.email) {
      log.error({ tokenId: oauthToken.id }, 'OAuth token agent identity is unavailable')
      return null
    }
    agentUser = {
      id: ensured.id,
      email: ensured.email,
      name: ensured.name,
      isAIAgent: true,
    }
  }

  // Update last-used telemetry, at most once per client per interval.
  //
  // This used to run on EVERY authenticated request, taking a row lock on a
  // handful of shared client rows — so an iOS sync burst had every request
  // queueing behind the same write for a timestamp nobody reads to the minute
  // (task 2e15b42f).
  if (shouldRecordClientUse(oauthToken.clientId)) {
    await prisma.oAuthClient.update({
      where: { id: oauthToken.clientId },
      data: { lastUsedAt: new Date() },
    }).catch(() => {
      // Ignore errors - this is just telemetry
    })
  }

  return {
    userId: oauthToken.userId,
    clientId: oauthToken.clientId,
    scopes: oauthToken.scopes,
    user: oauthToken.user,
    agentUser,
  }
}

/**
 * Revoke an access token
 */
export async function revokeAccessToken(token: string): Promise<boolean> {
  const result = await prisma.oAuthToken.updateMany({
    where: {
      accessToken: { in: oauthTokenLookup(token) },
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  })

  return result.count > 0
}

/**
 * Revoke all tokens for a client
 */
export async function revokeAllClientTokens(clientId: string): Promise<number> {
  const result = await prisma.oAuthToken.updateMany({
    where: {
      clientId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  })

  return result.count
}

/**
 * Generate authorization code for OAuth authorization flow
 */
export async function generateAuthorizationCode(
  clientId: string,
  userId: string,
  redirectUri: string,
  scopes: string[],
  codeChallenge?: string,
  codeChallengeMethod?: string,
  agentMailbox?: ConsentAgentMailbox,
): Promise<string> {
  const code = `astrid_code_${generateSecureToken(TOKEN_LENGTHS.AUTHORIZATION_CODE)}`
  const expiresAt = new Date(Date.now() + TOKEN_LIFETIMES.AUTHORIZATION_CODE * 1000)
  const validScopes = validateScopes(scopes)

  await prisma.oAuthAuthorizationCode.create({
    data: {
      // Hashed at rest, like the access and refresh tokens. This column used to
      // hold the code verbatim, so anyone who could read the table had directly
      // redeemable codes for their ten-minute lifetime — the same leak the
      // token hashing exists to prevent, on the credential that exchanges into
      // both tokens (task 0845cf1c).
      code: hashToken(code),
      clientId,
      userId,
      redirectUri,
      scopes: validScopes,
      agentMailbox: agentMailbox ?? null,
      codeChallenge,
      codeChallengeMethod,
      expiresAt,
    },
  })

  return code
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeAuthorizationCode(
  code: string,
  clientId: string,
  redirectUri: string,
  codeVerifier?: string,
): Promise<{
  accessToken: string
  refreshToken: string
  tokenType: string
  expiresIn: number
  scope: string
} | null> {
  // Find and validate auth code
  const authCode = await prisma.oAuthAuthorizationCode.findFirst({
    where: {
      // Prefix-guarded dual read, so codes minted before this change (and
      // still inside their ten-minute window at deploy time) still redeem.
      code: { in: oauthTokenLookup(code) },
      clientId,
      redirectUri,
      expiresAt: {
        gt: new Date(),
      },
      usedAt: null,
    },
  })

  if (!authCode) {
    return null
  }

  if (
    authCode.codeChallenge &&
    (!codeVerifier ||
      !verifyCodeChallenge(
        codeVerifier,
        authCode.codeChallenge,
        authCode.codeChallengeMethod || '',
      ))
  ) {
    return null
  }

  const codeMailbox = normalizeStoredAgentMailbox(authCode.agentMailbox)
  if (authCode.agentMailbox && !codeMailbox) {
    log.error(
      { codeId: authCode.id, agentMailbox: authCode.agentMailbox },
      'Authorization code carries an agent identity this deployment cannot resolve',
    )
    return null
  }

  // Mark code as used
  await prisma.oAuthAuthorizationCode.update({
    where: { id: authCode.id },
    data: { usedAt: new Date() },
  })

  // Generate token pair
  return await generateAccessAndRefreshToken(
    clientId,
    authCode.userId,
    authCode.scopes,
    codeMailbox,
  )
}

/**
 * Clean up expired tokens and auth codes
 * Should be called periodically (e.g., via cron job)
 */
export async function cleanupExpiredTokens(): Promise<{
  deletedTokens: number
  deletedCodes: number
}> {
  const now = new Date()

  // Delete expired access tokens (keep for 7 days after expiry for audit)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const deletedTokens = await prisma.oAuthToken.deleteMany({
    where: {
      expiresAt: {
        lt: sevenDaysAgo,
      },
    },
  })

  // Delete expired/used auth codes (keep for 1 day after expiry)
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const deletedCodes = await prisma.oAuthAuthorizationCode.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: oneDayAgo } },
        { usedAt: { lt: oneDayAgo } },
      ],
    },
  })

  return {
    deletedTokens: deletedTokens.count,
    deletedCodes: deletedCodes.count,
  }
}

/**
 * Validate required scopes for an operation
 * @throws Error if scopes are insufficient
 */
export function requireScopes(
  grantedScopes: string[],
  requiredScopes: string[]
): void {
  if (!hasRequiredScopes(grantedScopes, requiredScopes)) {
    throw new Error(
      `Insufficient scopes. Required: ${requiredScopes.join(', ')}. Granted: ${grantedScopes.join(', ')}`
    )
  }
}
