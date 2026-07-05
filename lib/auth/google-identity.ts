/**
 * Pure identity-verification rules for Google Sign-In (mirrors
 * lib/auth/apple-identity.ts).
 *
 * The route verifies the ID token via Google's tokeninfo endpoint (signature +
 * expiry), but that ALONE is not enough: a token minted for the victim's email
 * by ANY other Google OAuth client would be accepted and auto-linked. Two
 * checks close that:
 *  - aud MUST be one of our own client ids (the iOS Google client, plus the
 *    web GOOGLE_CLIENT_ID). A token whose aud is some other app is rejected.
 *  - email_verified MUST be affirmatively true.
 */

export interface GoogleTokenInfo {
  email?: string
  email_verified?: string | boolean
  sub?: string
  aud?: string
}

const IOS_GOOGLE_CLIENT_ID =
  '195880614240-nps6cdlcceliaru5d3b4p6pofjbs7sks.apps.googleusercontent.com'

/** Client ids whose tokens we accept. Env override: GOOGLE_ALLOWED_AUDIENCES. */
export function googleAllowedAudiences(
  env: string | undefined = process.env.GOOGLE_ALLOWED_AUDIENCES,
  webClientId: string | undefined = process.env.GOOGLE_CLIENT_ID
): string[] {
  const fromEnv = (env ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (fromEnv.length > 0) return fromEnv
  return [IOS_GOOGLE_CLIENT_ID, ...(webClientId ? [webClientId] : [])]
}

export function isGoogleEmailVerified(claim: string | boolean | undefined): boolean {
  return claim === true || claim === 'true'
}

export interface GoogleIdentityCheck {
  ok: boolean
  reason?: 'aud_mismatch' | 'email_unverified' | 'missing_email' | 'missing_sub'
  email?: string
}

/**
 * Validate a tokeninfo payload for account lookup/linking. Returns ok:false
 * with a reason on any failed check; the caller rejects the request.
 */
export function verifyGoogleIdentity(
  info: GoogleTokenInfo,
  allowedAudiences: string[] = googleAllowedAudiences()
): GoogleIdentityCheck {
  if (!info.email) return { ok: false, reason: 'missing_email' }
  if (!info.sub) return { ok: false, reason: 'missing_sub' }
  if (!info.aud || !allowedAudiences.includes(info.aud)) {
    return { ok: false, reason: 'aud_mismatch' }
  }
  if (!isGoogleEmailVerified(info.email_verified)) {
    return { ok: false, reason: 'email_unverified' }
  }
  return { ok: true, email: info.email.toLowerCase() }
}
