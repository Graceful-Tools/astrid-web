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
 * Verify client secret against hash
 */
export function verifyClientSecret(secret: string, hash: string): boolean {
  const secretHash = hashClientSecret(secret)
  return crypto.timingSafeEqual(
    Buffer.from(secretHash),
    Buffer.from(hash)
  )
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
  scopes: string[]
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
      refreshToken: { in: [hashToken(refreshToken), refreshToken] },
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

  // Revoke old token
  await prisma.oAuthToken.update({
    where: { id: existingToken.id },
    data: { revokedAt: new Date() },
  })

  // Generate new token pair
  return await generateAccessAndRefreshToken(
    clientId,
    existingToken.userId,
    existingToken.scopes
  )
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
} | null> {
  log.info({
    tokenFp: hashToken(token).slice(0, 12), // fingerprint, not the token itself
  }, '[OAuth] validateAccessToken called:')

  const oauthToken = await prisma.oAuthToken.findFirst({
    where: {
      accessToken: { in: [hashToken(token), token] },
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
    log.info('[OAuth] Token not found or expired')
    // Debug: Check if token exists at all
    const anyToken = await prisma.oAuthToken.findFirst({
      where: { accessToken: { in: [hashToken(token), token] } },
      select: { id: true, expiresAt: true, revokedAt: true },
    })
    if (anyToken) {
      log.info({ anyToken }, '[OAuth] Token exists but invalid:')
    } else {
      log.info('[OAuth] Token does not exist in database')
    }
    return null
  }

  log.info({ userId: oauthToken.userId }, '[OAuth] Token validated successfully for user')

  // Update last used timestamp for the client
  await prisma.oAuthClient.update({
    where: { id: oauthToken.clientId },
    data: { lastUsedAt: new Date() },
  }).catch(() => {
    // Ignore errors - this is just telemetry
  })

  return {
    userId: oauthToken.userId,
    clientId: oauthToken.clientId,
    scopes: oauthToken.scopes,
    user: oauthToken.user,
  }
}

/**
 * Revoke an access token
 */
export async function revokeAccessToken(token: string): Promise<boolean> {
  const result = await prisma.oAuthToken.updateMany({
    where: {
      accessToken: { in: [hashToken(token), token] },
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
  scopes: string[]
): Promise<string> {
  const code = `astrid_code_${generateSecureToken(TOKEN_LENGTHS.AUTHORIZATION_CODE)}`
  const expiresAt = new Date(Date.now() + TOKEN_LIFETIMES.AUTHORIZATION_CODE * 1000)
  const validScopes = validateScopes(scopes)

  await prisma.oAuthAuthorizationCode.create({
    data: {
      code,
      clientId,
      userId,
      redirectUri,
      scopes: validScopes,
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
  redirectUri: string
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
      code,
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

  // Mark code as used
  await prisma.oAuthAuthorizationCode.update({
    where: { id: authCode.id },
    data: { usedAt: new Date() },
  })

  // Generate token pair
  return await generateAccessAndRefreshToken(
    clientId,
    authCode.userId,
    authCode.scopes
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
