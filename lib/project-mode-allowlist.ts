/**
 * People who get Project Mode from configuration, on top of the per-user
 * grants made from astrid.cc/admin (AWTD-1660).
 *
 * The list is `PROJECT_MODE_ALLOWLIST_EMAILS` (comma-separated), read here and
 * nowhere else. It is not written out in code on purpose: a whitelabel
 * deployment would inherit somebody else's address, which is exactly what
 * `npm run check:reuse` (hardcoded-identity) and lib/admin-auth.ts's history
 * (task 7610dd07) warn against. Unset means nobody is allowlisted.
 *
 * Applied where per-user flags are evaluated (`getEffectiveFeatures` in
 * lib/feature-flags.ts), so the web client, iOS (`GET /api/v1/features`) and
 * every server gate (`projectModeGate`) agree about it. Only an account with a
 * VERIFIED email matches — a passkey signup creates an unverified account for
 * any address, and that must not be enough (same rule as INITIAL_ADMIN_EMAIL).
 *
 * It grants the RUNTIME flag only. A deployment built without Project Mode
 * (`CAPABILITIES.projectMode` off) stays without it: lib/project-mode.ts checks
 * the capability before it ever asks for the flag.
 */

/** The configured addresses, lower-case. Read per call so a test or redeploy sees a change. */
export function projectModeAllowlist(): string[] {
  return (process.env.PROJECT_MODE_ALLOWLIST_EMAILS ?? '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean)
}

export function isProjectModeAllowlisted(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase()
  if (!normalized) return false
  return projectModeAllowlist().includes(normalized)
}
