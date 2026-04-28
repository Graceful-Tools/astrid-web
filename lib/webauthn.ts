import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server"
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/types"
import { prisma } from "./prisma"
import { createLogger } from '@/lib/logger'

const log = createLogger('webauthn')


// Relying Party configuration
const rpName = "Astrid"

// Robust production detection - check multiple signals
function isProductionEnvironment(): boolean {
  // Explicit production env
  if (process.env.NODE_ENV === "production") return true
  // Vercel production deployment
  if (process.env.VERCEL_ENV === "production") return true
  // Check if NEXTAUTH_URL points to production domain
  if (process.env.NEXTAUTH_URL?.includes("astrid.cc")) return true
  return false
}

const isProduction = isProductionEnvironment()
const rpID = isProduction ? "astrid.cc" : "localhost"
// Support astrid.cc, www.astrid.cc, and any *.astrid.cc subdomain in production
const baseOrigins = isProduction
  ? ["https://astrid.cc", "https://www.astrid.cc"]
  : [`http://localhost:${process.env.PORT || 3000}`]

// Helper to get expected origins including the current request origin if it's a valid subdomain
export function getExpectedOrigins(requestOrigin?: string): string[] {
  if (!isProduction || !requestOrigin) return baseOrigins

  // Check if requestOrigin is a valid *.astrid.cc subdomain
  try {
    const url = new URL(requestOrigin)
    if (url.protocol === "https:" && url.hostname.endsWith(".astrid.cc")) {
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

export async function getRegistrationOptions(userId: string, email: string) {
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
        id: Buffer.from(auth.credentialID, "base64url"),
        type: "public-key" as const,
        transports: auth.transports?.split(",") as AuthenticatorTransportFuture[] | undefined,
      }))
    : undefined

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: userId,
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
      expectedRPID: rpID,
      requestOrigin,
    }, "[WebAuthn] Verifying registration:")

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: false, // We use "preferred" in options, so don't require it
    })

    log.info({ verified: verification.verified }, "[WebAuthn] Verification result:")

    if (verification.verified && verification.registrationInfo) {
      const { credentialID, credentialPublicKey, counter, credentialDeviceType, credentialBackedUp } = verification.registrationInfo

      // Store the credential
      await prisma.authenticator.create({
        data: {
          userId,
          credentialID: Buffer.from(credentialID).toString("base64url"),
          credentialPublicKey: Buffer.from(credentialPublicKey).toString("base64"),
          counter: BigInt(counter),
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

export async function getAuthenticationOptions(email?: string) {
  let allowCredentials: { id: Uint8Array; type: "public-key"; transports?: AuthenticatorTransportFuture[] }[] | undefined

  if (email) {
    // If email is provided, only allow credentials for that user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { authenticators: true },
    })

    if (user && user.authenticators.length > 0) {
      allowCredentials = user.authenticators.map((auth) => ({
        id: Buffer.from(auth.credentialID, "base64url"),
        type: "public-key" as const,
        transports: auth.transports?.split(",") as AuthenticatorTransportFuture[] | undefined,
      }))
    }
  }

  const options = await generateAuthenticationOptions({
    rpID,
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
      expectedRPID: rpID,
      requireUserVerification: false, // We use "preferred" in options, so don't require it
      authenticator: {
        credentialID: Buffer.from(authenticator.credentialID, "base64url"),
        credentialPublicKey: Buffer.from(authenticator.credentialPublicKey, "base64"),
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
