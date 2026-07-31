/**
 * Project Mode access — the single place that answers "can this user use
 * projects and boards?" (tasks dd7172d8, e627f967).
 *
 * Two gates, checked in this order, and the order matters:
 *
 *   1. CAPABILITIES.projectMode — build-time, per deployment, absolute. A
 *      deployment without it does not have the feature at all, and no runtime
 *      flag can turn it back on.
 *   2. The `project_mode` runtime flag — per user, admin-controlled, how an
 *      individual gets access after requesting it.
 *
 * Never inline this pair of checks at a call site: that is exactly how the
 * inline-permission drift documented in docs/CODE_REUSE_AND_CONSISTENCY.md
 * started. Call `canUseProjectMode` (server) or `useProjectMode` (client).
 */

import { NextResponse } from 'next/server'
import { CAPABILITIES } from '@/lib/brand/capabilities'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { PROJECT_MODE_FEATURE_KEY } from '@/lib/project-mode-shared'

// Re-exported for server callers. Client components must import it from
// lib/project-mode-shared directly — see that file for why.
export { PROJECT_MODE_FEATURE_KEY }

/** Does this deployment ship Project Mode at all? Build-time, no user involved. */
export function projectModeCompiledIn(): boolean {
  return CAPABILITIES.projectMode
}

/**
 * Can this specific user create and use projects/boards right now?
 *
 * Returns false — not an error — when the capability is off, so callers can
 * treat "not built" and "not granted" identically at the call site while the
 * HTTP layer still distinguishes them (404 vs. the request-access affordance).
 */
export async function canUseProjectMode(userId: string): Promise<boolean> {
  if (!projectModeCompiledIn()) return false
  return isFeatureEnabled(PROJECT_MODE_FEATURE_KEY, userId)
}

/**
 * Guard for project/board route handlers.
 *
 * Returns a Response to return immediately, or null to continue.
 *
 * The two failure modes are deliberately different:
 *   - capability off  -> 404, the feature does not exist in this deployment and
 *     should look absent rather than forbidden (same reasoning as
 *     `capabilityGate` in lib/brand/capabilities.ts).
 *   - flag off        -> 403 with `reason: "not_granted"`, which the client
 *     turns into the request-access affordance. A 404 here would be a lie: the
 *     feature exists, this user just hasn't been given it.
 */
export async function projectModeGate(userId: string): Promise<NextResponse | null> {
  if (!projectModeCompiledIn()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!(await isFeatureEnabled(PROJECT_MODE_FEATURE_KEY, userId))) {
    return NextResponse.json(
      {
        error: 'Project Mode is not enabled for this account',
        reason: 'not_granted',
        featureKey: PROJECT_MODE_FEATURE_KEY,
      },
      { status: 403 }
    )
  }

  return null
}
