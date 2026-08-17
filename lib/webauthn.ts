import { BRAND } from '@/lib/brand/config'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server"
import { isoUint8Array } from "@simplewebauthn/server/helpers"
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/types"
import { prisma } from "./prisma"
import { createLogger } from '@/lib/logger'

const log = createLogger('webauthn')


// Relying Party configuration
// Shown by the authenticator when the user creates or uses a passkey.
// Unlike rpID this is a display label, so changing it does not invalidate credentials.
const rpName = BRAND.appName

// Robust production detection - check multiple signals
function isProductionEnvironment(): boolean {
  // Explicit production env
  if (process.env.NODE_ENV === "production") return true
  // Vercel production deployment
  if (process.env.VERCEL_ENV === "production") return true
  // Check if NEXTAUTH_URL points to production domain
  if (process.env.NEXTAUTH_URL?.includes(BRAND.domain)) return true
  return false
}

const isProduction = isProductionEnvironment()

/**
 * WebAuthn Relying Party ID — the domain credentials are scoped to.
 *
 * Brand-derived (task 97208a72), which is a no-op for Astrid since BRAND.domain
 * defaults to astrid.cc. Note this is a CREDENTIAL BINDING, not cosmetic: changing it
 * on a live deployment invalidates every passkey already registered, because the
 * authenticator will not release a credential scoped to a different RP ID.
 */
/**
 * The host this deployment is actually served from, or null when it cannot be
 * determined. NEXTAUTH_URL is authoritative; VERCEL_URL covers preview deployments
 * that have no explicit NEXTAUTH_URL.
 */
function servingHost(): string | null {
  const candidate = process.env.NEXTAUTH_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined)
  if (!candidate) return null
  try {
    return new URL(candidate).hostname
  } catch {
    return null
  }
}

/**
 * Resolve the Relying Party ID.
 *
 * WebAuthn requires the RP ID to equal the origin's host or be a registrable-domain
 * suffix of it. `BRAND.domain` is the brand's NOMINAL domain and is not necessarily
 * where the app is served — an enterprise preview, a staging host, or any deployment
 * whose brand domain has not been pointed at it yet. Claiming an RP ID the browser is
 * not on makes every passkey call fail with "invalid for this domain", which is exactly
 * what the Acme preview did while serving from *.vercel.app.
 *
 * So: use the brand domain when the serving host really is that domain or a subdomain
 * of it, and otherwise scope credentials to the serving host itself.
 *
 * For Astrid this is a no-op — served from www.astrid.cc, which is a subdomain of
 * astrid.cc, so the RP ID stays astrid.cc and existing passkeys keep working. That
 * matters: the RP ID is a CREDENTIAL BINDING, and changing it on a live deployment
 * invalidates every passkey already registered.
 *
 * NEXT_PUBLIC_BRAND_WEBAUTHN_RP_ID overrides all of this, for a deployment that knows
 * better than we can infer.
 */
export function resolveRpID(requestOrigin?: string): string {
  const explicit = process.env.NEXT_PUBLIC_BRAND_WEBAUTHN_RP_ID?.trim()
  if (explicit) return explicit
  if (!isProduction) return "localhost"

  // The origin the browser is actually on wins. Environment variables describe the
  // deployment's canonical URL, which is NOT necessarily where this request arrived:
  // on a preview, NEXTAUTH_URL still points at production, so an env-derived RP ID
  // fails the browser's check even though it looks right in logs.
  let host: string | null = null
  if (requestOrigin) {
    try {
      host = new URL(requestOrigin).hostname
    } catch {
      host = null
    }
  }
  host = host ?? servingHost()
  if (!host) return BRAND.domain

  // Leading dot matters: without it `evil-astrid.cc` would also look like a subdomain.
  const isBrandHost = host === BRAND.domain || host.endsWith(`.${BRAND.domain}`)
  return isBrandHost ? BRAND.domain : host
}

/**
 * Module-level default, used only for logging and for callers with no request in hand.
 * Every ceremony resolves its own RP ID from the request origin — see resolveRpID.
 */
const rpID = resolveRpID()

// The brand's own origins, plus the host we are actually served from — otherwise a
// deployment reachable at a non-brand host cannot complete a passkey ceremony.
const baseOrigins = isProduction
  ? Array.from(new Set([
      `https://${BRAND.domain}`,
      `https://www.${BRAND.domain}`,
      ...(servingHost() ? [`https://${servingHost()}`] : []),
    ]))
  : [`http://localhost:${process.env.PORT || 3000}`]

/**
 * Suffix for the subdomain check below. The LEADING DOT is load-bearing: matching on
 * `endsWith(BRAND.domain)` alone would also accept `evil-astrid.cc`, letting an
 * attacker-controlled host be treated as an expected WebAuthn origin.
 */
const SUBDOMAIN_SUFFIX = `.${BRAND.domain}`

// Helper to get expected origins including the current request origin if it's a valid subdomain
export function getExpectedOrigins(requestOrigin?: string): string[] {
  if (!isProduction || !requestOrigin) return baseOrigins

  // Check if requestOrigin is a valid subdomain of the brand domain
  try {
    const url = new URL(requestOrigin)
    if (url.protocol === "https:" && url.hostname.endsWith(SUBDOMAIN_SUFFIX)) {
      // Include this subdomain in expected origins
      return [...baseOrigins, requestOrigin]
    }
  } catch {
    // Invalid URL, ignore
  }
  return baseOrigins
}

// Default expected origins (without request context)
const expectedOrigins = baseOrigins
// For backwards compatibility, keep single origin export
const origin = expectedOrigins[0]

// Log configuration on module load (helps debug production issues)
if (typeof process !== "undefined") {
  log.info({
    rpID,
    expectedOrigins,
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    isProduction,
  }, "[WebAuthn] Configuration:")
}

export interface StoredChallenge {
  challenge: string
  userId?: string
  email?: string
  expiresAt: Date
}

// Store challenge in database (persistent across serverless invocations)
export async function storeChallenge(sessionId: string, data: Omit<StoredChallenge, "expiresAt">) {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

  await prisma.webAuthnChallenge.upsert({
    where: { id: sessionId },
    update: {
      challenge: data.challenge,
      userId: data.userId,
      email: data.email,
      expiresAt,
    },
    create: {
      id: sessionId,
      challenge: data.challenge,
      userId: data.userId,
      email: data.email,
      expiresAt,
    },
  })
}

export async function getChallenge(sessionId: string): Promise<StoredChallenge | undefined> {
  const data = await prisma.webAuthnChallenge.findUnique({
    where: { id: sessionId },
  })

  if (data && data.expiresAt > new Date()) {
    return {
      challenge: data.challenge,
      userId: data.userId || undefined,
      email: data.email || undefined,
      expiresAt: data.expiresAt,
    }
  }

  // Clean up expired challenge
  if (data) {
    await prisma.webAuthnChallenge.delete({ where: { id: sessionId } }).catch(() => {})
  }

  return undefined
}

export async function deleteChallenge(sessionId: string) {
  await prisma.webAuthnChallenge.delete({ where: { id: sessionId } }).catch(() => {})
}

export async function getRegistrationOptions(userId: string, email: string, requestOrigin?: string) {
  // Ensure prisma is available
  if (!prisma) {
    throw new Error("Database connection not available")
  }

  // Get existing authenticators for this user
  const existingAuthenticators = await prisma.authenticator.findMany({
    where: { userId },
    select: {
      credentialID: true,
      transports: true,
    },
  })

  // Build exclude credentials list (only if there are existing ones)
  const excludeCredentials = existingAuthenticators.length > 0
    ? existingAuthenticators.map((auth) => ({
        // v13 takes the credential id as the base64url STRING, which is exactly what the
        // column already holds — the old Buffer round-trip was decoding it only for the
        // library to re-encode it. Stored bytes are unchanged, so existing passkeys still match.
        id: auth.credentialID,
        transports: auth.transports?.split(",") as AuthenticatorTransportFuture[] | undefined,
      }))
    : undefined

  const options = await generateRegistrationOptions({
    rpName,
    rpID: resolveRpID(requestOrigin),
    // v13 takes the user handle as bytes rather than a string. This is the value the
    // authenticator stores alongside the passkey; sign-in looks credentials up by
    // credential id, not by user handle, so existing passkeys are unaffected.
    userID: isoUint8Array.fromUTF8String(userId),
    userName: email,
    userDisplayName: email.split("@")[0] || email,
    attestationType: "none",
    excludeCredentials,
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  })

  return options
}

export async function verifyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  expectedChallenge: string,
  requestOrigin?: string
) {
  try {
    const origins = getExpectedOrigins(requestOrigin)
    log.info({
      userId,
      expectedChallenge: expectedChallenge.substring(0, 20) + "...",
      expectedOrigin: origins,
      expectedRPID: resolveRpID(requestOrigin),
      requestOrigin,
    }, "[WebAuthn] Verifying registration:")

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: resolveRpID(requestOrigin),
      requireUserVerification: false, // We use "preferred" in options, so don't require it
    })

    log.info({ verified: verification.verified }, "[WebAuthn] Verification result:")

    if (verification.verified && verification.registrationInfo) {
      // v13 groups the credential fields under `credential` and hands back the id already
      // base64url-encoded. The values written to the columns are byte-for-byte what v9
      // wrote, so rows created before and after this upgrade are indistinguishable.
      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo

      // Store the credential
      await prisma.authenticator.create({
        data: {
          userId,
          credentialID: credential.id,
          credentialPublicKey: Buffer.from(credential.publicKey).toString("base64"),
          counter: BigInt(credential.counter),
          credentialDeviceType,
          credentialBackedUp,
          transports: response.response.transports?.join(","),
        },
      })

      return { verified: true }
    }

    return { verified: false, error: "Verification not confirmed" }
  } catch (error) {
    log.error({ err: error }, "[WebAuthn] Registration verification error:")
    return { verified: false, error: error instanceof Error ? error.message : "Unknown error" }
  }
}

export async function getAuthenticationOptions(email?: string, requestOrigin?: string) {
  let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined

  if (email) {
    // If email is provided, only allow credentials for that user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { authenticators: true },
    })

    if (user && user.authenticators.length > 0) {
      allowCredentials = user.authenticators.map((auth) => ({
        id: auth.credentialID,
        transports: auth.transports?.split(",") as AuthenticatorTransportFuture[] | undefined,
      }))
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: resolveRpID(requestOrigin),
    userVerification: "preferred",
    allowCredentials,
  })

  return options
}

export async function verifyAuthentication(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  requestOrigin?: string
) {
  // Find the authenticator by credential ID
  const authenticator = await prisma.authenticator.findUnique({
    where: { credentialID: response.id },
    include: { user: true },
  })

  if (!authenticator) {
    return { verified: false, error: "No passkey found for this account. Try signing in with Google or email/password instead, then add a passkey in Settings." }
  }

  try {
    const origins = getExpectedOrigins(requestOrigin)
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: resolveRpID(requestOrigin),
      requireUserVerification: false, // We use "preferred" in options, so don't require it
      // v13 renamed `authenticator` to `credential` and takes the id as the stored
      // base64url string. The public key is still raw bytes, still decoded from the same
      // base64 column.
      credential: {
        id: authenticator.credentialID,
        publicKey: new Uint8Array(Buffer.from(authenticator.credentialPublicKey, "base64")),
        counter: Number(authenticator.counter),
        transports: authenticator.transports?.split(",") as AuthenticatorTransportFuture[] | undefined,
      },
    })

    if (verification.verified) {
      // Update the counter
      await prisma.authenticator.update({
        where: { id: authenticator.id },
        data: { counter: BigInt(verification.authenticationInfo.newCounter) },
      })

      return {
        verified: true,
        user: authenticator.user,
      }
    }

    return { verified: false, error: "Verification failed" }
  } catch (error) {
    log.error({ err: error }, "[WebAuthn] Authentication verification error:")
    return { verified: false, error: "Verification error" }
  }
}

export async function getUserPasskeys(userId: string) {
  return prisma.authenticator.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      credentialDeviceType: true,
      credentialBackedUp: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  })
}

export async function deletePasskey(userId: string, passkeyId: string) {
  const passkey = await prisma.authenticator.findFirst({
    where: { id: passkeyId, userId },
  })

  if (!passkey) {
    return { success: false, error: "Passkey not found" }
  }

  await prisma.authenticator.delete({
    where: { id: passkeyId },
  })

  return { success: true }
}

export async function renamePasskey(userId: string, passkeyId: string, name: string) {
  const passkey = await prisma.authenticator.findFirst({
    where: { id: passkeyId, userId },
  })

  if (!passkey) {
    return { success: false, error: "Passkey not found" }
  }

  await prisma.authenticator.update({
    where: { id: passkeyId },
    data: { name },
  })

  return { success: true }
}

export { rpID, origin, isProduction }
