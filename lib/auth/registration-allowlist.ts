/**
 * Who may create an account on this deployment (ADEV-104).
 *
 * `REGISTRATION_ALLOWED_EMAIL_DOMAINS` is a comma-separated list of domains
 * (`acme.example`) and/or full addresses (`contractor@elsewhere.test`), read
 * here and nowhere else. Unset means registration is open, which is astrid.cc.
 *
 * Without it, anyone who reached a self-hosted instance could create a passkey
 * account for any address. It is consulted ONLY where an account would be
 * created: passkey sign-up (register/options and register/verify) and a
 * federated sign-in whose email has no account yet (federated-identity-linking).
 * Signing in to an existing account, and adding a passkey from inside a
 * session, never ask — an operator who tightens the list does not lock out the
 * people already using the instance.
 *
 * Domains match exactly: `acme.example` does not admit `sub.acme.example`. List
 * each subdomain you mean. The bootstrap admin (`INITIAL_ADMIN_EMAIL`) is always
 * admitted, so a list that forgets it cannot leave an instance without one.
 */

/** Stable code a client maps to its own copy (passkeyErrors.registrationNotAllowed). */
export const REGISTRATION_NOT_ALLOWED = 'registration_not_allowed'

/** English fallback for clients that show the server's `error` verbatim. */
export const REGISTRATION_NOT_ALLOWED_MESSAGE =
  'Sign-up on this server is limited to approved email addresses.'

/** The configured entries, lower-case. Read per call so a test or redeploy sees a change. */
function registrationAllowlist(): string[] {
  return (process.env.REGISTRATION_ALLOWED_EMAIL_DOMAINS ?? '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean)
}

export function isRegistrationAllowed(email: string): boolean {
  const allowlist = registrationAllowlist()
  if (allowlist.length === 0) return true

  const normalized = email.trim().toLowerCase()
  const initialAdmin = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase()
  if (initialAdmin && normalized === initialAdmin) return true

  const domain = normalized.slice(normalized.lastIndexOf('@') + 1)
  return allowlist.some(entry => (entry.includes('@') ? entry === normalized : entry === domain))
}

/** The JSON body a route returns (with status 403) when it refuses a sign-up. */
export function registrationNotAllowedBody() {
  return { error: REGISTRATION_NOT_ALLOWED_MESSAGE, code: REGISTRATION_NOT_ALLOWED }
}
