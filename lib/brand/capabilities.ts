/**
 * Build-time capability configuration.
 *
 * Task 97208a72. An enterprise deployment may want the product's front end while
 * supplying its own back-end services: no Google sign-in, no Google Tasks sync, GitHub
 * Issues but not MCP, and so on. Every such dependency is a capability that can be
 * switched off at build time.
 *
 * Distinct from lib/feature-flags.ts, which is a *runtime*, per-user, database-backed
 * rollout mechanism. These are compile/deploy-time deployment decisions and sit ABOVE
 * that: a capability disabled here is off for everyone, and no runtime flag can turn it
 * back on. Call sites that consult both must check the capability first.
 *
 * Security note: disabling a capability MUST refuse the request server-side, not merely
 * hide a button. Hiding UI while leaving the endpoint reachable is not a configuration
 * option, it is an unenforced access-control boundary. Route-level enforcement lives in
 * lib/api-auth-wrapper.ts (`capability` option), which rejects before authenticating —
 * cheaper than the current path, and it does not disclose whether the caller would
 * otherwise have had access.
 *
 * Every capability defaults to ENABLED, so an existing deployment that sets nothing
 * behaves exactly as before.
 *
 * These are `NEXT_PUBLIC_` because the UI must reflect them (there is no point offering
 * a Google sign-in button a disabled server will refuse). They are switches, not
 * secrets. Reading the same variable on both sides is deliberate: it makes a
 * client/server disagreement impossible.
 *
 * NOTE: `process.env.NEXT_PUBLIC_*` must be referenced *literally* for Next.js to inline
 * it into the client bundle — do not refactor these into a loop or a computed key.
 */

/** A capability is on unless explicitly set to "false"/"0"/"off". */
function enabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return true
  return !['false', '0', 'off', 'no'].includes(normalized)
}

export const CAPABILITIES = {
  // --- Authentication -----------------------------------------------------
  /** Google OAuth sign-in. */
  authGoogle: enabled(process.env.NEXT_PUBLIC_BRAND_ENABLE_AUTH_GOOGLE),
  /** Sign in with Apple. */
  authApple: enabled(process.env.NEXT_PUBLIC_BRAND_ENABLE_AUTH_APPLE),
  /** WebAuthn passkeys. */
  authPasskey: enabled(process.env.NEXT_PUBLIC_BRAND_ENABLE_AUTH_PASSKEY),

  // --- External sync ------------------------------------------------------
  /** Two-way sync with Google Tasks. */
  syncGoogleTasks: enabled(process.env.NEXT_PUBLIC_BRAND_ENABLE_SYNC_GOOGLE_TASKS),
  /** Two-way sync with GitHub Issues. */
  syncGithubIssues: enabled(process.env.NEXT_PUBLIC_BRAND_ENABLE_SYNC_GITHUB_ISSUES),

  // --- Assistant integrations ---------------------------------------------
  /** Model Context Protocol server endpoint. */
  integrationMcp: enabled(process.env.NEXT_PUBLIC_BRAND_ENABLE_MCP),
  /** Third-party OpenClaw workers. */
  integrationOpenClaw: enabled(process.env.NEXT_PUBLIC_BRAND_ENABLE_OPENCLAW),
  /** OpenAPI + ai-plugin discovery documents for ChatGPT actions. */
  integrationChatGptActions: enabled(process.env.NEXT_PUBLIC_BRAND_ENABLE_CHATGPT_ACTIONS),

  // --- Other services -----------------------------------------------------
  /** Creating tasks by emailing the inbound address. */
  emailToTask: enabled(process.env.NEXT_PUBLIC_BRAND_ENABLE_EMAIL_TO_TASK),
  /** Public calendar (.ics) feed of tasks. */
  calendarFeed: enabled(process.env.NEXT_PUBLIC_BRAND_ENABLE_CALENDAR_FEED),
} as const

export type CapabilityKey = keyof typeof CAPABILITIES

/** Is this capability available in this deployment? */
export function hasCapability(key: CapabilityKey): boolean {
  return CAPABILITIES[key]
}

/**
 * Guard for route handlers that do NOT go through `withAuth` — OAuth callbacks,
 * webhooks and other unauthenticated endpoints.
 *
 * Returns a 404 Response to return immediately, or null to continue:
 *
 *     const blocked = capabilityGate('syncGoogleTasks')
 *     if (blocked) return blocked
 *
 * Same 404-not-403 reasoning as the `withAuth` option: a capability this deployment
 * does not have should look absent, not forbidden.
 */
export function capabilityGate(key: CapabilityKey): Response | null {
  if (CAPABILITIES[key]) return null
  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * At least one sign-in method must remain, or the deployment is unusable and every
 * user is locked out. Guarded at startup by assertUsableAuthConfiguration().
 */
export const AUTH_CAPABILITIES: readonly CapabilityKey[] = [
  'authGoogle',
  'authApple',
  'authPasskey',
]

export function enabledAuthMethods(): CapabilityKey[] {
  return AUTH_CAPABILITIES.filter((key) => CAPABILITIES[key])
}

/**
 * Fail loudly rather than shipping a build nobody can sign in to.
 *
 * A misconfigured deployment that disables every sign-in method is not a degraded
 * feature — it is a total outage that would otherwise only surface when a real user
 * hit the sign-in page.
 */
export function assertUsableAuthConfiguration(): void {
  if (enabledAuthMethods().length === 0) {
    throw new Error(
      'Brand configuration disables every authentication method — no one could sign in. ' +
        'Enable at least one of NEXT_PUBLIC_BRAND_ENABLE_AUTH_GOOGLE, ' +
        'NEXT_PUBLIC_BRAND_ENABLE_AUTH_APPLE or NEXT_PUBLIC_BRAND_ENABLE_AUTH_PASSKEY.'
    )
  }
}
