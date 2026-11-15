/**
 * Pilot limits for business runtime bindings (Jon, 2026-11-14). Widening one is
 * a decision, not a refactor.
 *
 * Their own module, with no imports, so the resolver
 * (lib/ai/runtime-binding-resolver.ts, AWTD-1667) and enrollment
 * (lib/runtime-binding/enrollment-rules.ts, AWTD-1668, which the admin page
 * also loads in the browser) share one copy without pulling Prisma into a client
 * bundle.
 */
export const PILOT_SCOPE = 'deployment-business'
export const PILOT_TRANSPORT = 'polling'
export const PILOT_MAX_CONCURRENT_RUNS = 1
export const PILOT_BILLING_SOURCE = 'business-provided'
