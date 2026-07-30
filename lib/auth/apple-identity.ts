/**
 * Pure identity-resolution rules for Sign in with Apple.
 *
 * Security contract (locked by tests/lib/apple-identity.test.ts):
 * - The email used to look up / link / create an Astrid account comes ONLY
 *   from the cryptographically verified identity token — NEVER from the
 *   request body. Trusting the body let an attacker present their own valid
 *   Apple token alongside a victim's email and take over the victim's
 *   account (linking their providerAccountId onto it and minting a session).
 * - Linking to an EXISTING user additionally requires the token's
 *   email_verified claim to be affirmatively true (Apple sends string or
 *   boolean).
 * - The token's audience must be one of our client ids (the iOS bundle id,
 *   plus any Services ID), overridable via APPLE_CLIENT_IDS (comma-separated).
 */

export interface AppleIdentityClaims {
  sub: string
  email?: string
  email_verified?: string | boolean
  aud?: string | string[]
}

/** Client ids whose tokens we accept. Env override: APPLE_CLIENT_IDS. */
export function appleAllowedAudiences(env: string | undefined = process.env.APPLE_CLIENT_IDS): string[] {
  const fromEnv = (env ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  // Default: accept both the iOS and Mac app bundle ids (each app's Apple identity token
  // carries its own bundle id as `aud`). Override with APPLE_CLIENT_IDS (e.g. to add a Services ID).
  return fromEnv.length > 0
    ? fromEnv
    // Apple bundle identifiers, not branding: these are provisioning identities
    // registered with Apple and tied to the signing certificates. Renaming them is an
    // App Store Connect change, explicitly out of scope for whitelabeling (task 97208a72).
    : ['Graceful-Tools-Inc.Astrid-App', 'Graceful-Tools-Inc.Astrid-Mac']
}

export function isEmailVerified(claim: string | boolean | undefined): boolean {
  return claim === true || claim === 'true'
}

export interface ResolvedAppleIdentity {
  /** Email to key account lookup/creation on — from the token, or null to reject. */
  email: string | null
  /** True only when the token affirms the email is verified. */
  emailVerified: boolean
}

/**
 * The ONLY email that may drive account lookup/linking is the verified
 * token claim. The request-body email is accepted solely as display
 * metadata by callers and must never be passed here.
 */
export function resolveAppleIdentity(claims: AppleIdentityClaims): ResolvedAppleIdentity {
  const email = claims.email?.trim().toLowerCase() || null
  return { email, emailVerified: isEmailVerified(claims.email_verified) }
}
