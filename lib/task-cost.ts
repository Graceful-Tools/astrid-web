/**
 * Task Cost access — the single place that answers "can this user use per-task
 * cost metering?" (task 315949e1).
 *
 * Two gates, checked in this order, and the order matters:
 *
 *   1. CAPABILITIES.taskCost — build-time, per deployment, absolute. A
 *      deployment without it does not have the feature at all, and no runtime
 *      flag can turn it back on.
 *   2. The `task_cost` runtime flag — per user, admin-controlled, how an
 *      individual gets access after requesting it.
 *
 * Never inline this pair at a call site. That is the drift documented in
 * docs/CODE_REUSE_AND_CONSISTENCY.md, and Project Mode already paid for the
 * lesson — this file is deliberately a mirror of lib/project-mode.ts rather
 * than a new take on the same problem.
 */

import { NextResponse } from 'next/server'
import { CAPABILITIES } from '@/lib/brand/capabilities'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { TASK_COST_FEATURE_KEY } from '@/lib/task-cost-shared'

// Re-exported for server callers. Client components must import it from
// lib/task-cost-shared directly — see that file for why.
export { TASK_COST_FEATURE_KEY }

/** Does this deployment ship Task Cost at all? Build-time, no user involved. */
export function taskCostCompiledIn(): boolean {
  return CAPABILITIES.taskCost
}

/**
 * Can this specific user record and see per-task cost right now?
 *
 * Returns false — not an error — when the capability is off, so callers can
 * treat "not built" and "not granted" identically while the HTTP layer still
 * distinguishes them (404 vs. the request-access affordance).
 */
export async function canUseTaskCost(userId: string): Promise<boolean> {
  if (!taskCostCompiledIn()) return false
  return isFeatureEnabled(TASK_COST_FEATURE_KEY, userId)
}

/**
 * Guard for task-cost route handlers.
 *
 * Returns a Response to return immediately, or null to continue.
 *
 * The two failure modes are deliberately different:
 *   - capability off  -> 404, the feature does not exist in this deployment and
 *     should look absent rather than forbidden.
 *   - flag off        -> 403 with `reason: "not_granted"`, which the client
 *     turns into the request-access affordance. A 404 here would be a lie: the
 *     feature exists, this user just has not been given it.
 */
export async function taskCostGate(userId: string): Promise<NextResponse | null> {
  if (!taskCostCompiledIn()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!(await isFeatureEnabled(TASK_COST_FEATURE_KEY, userId))) {
    return NextResponse.json(
      {
        error: 'Task Cost is not enabled for this account',
        reason: 'not_granted',
        featureKey: TASK_COST_FEATURE_KEY,
      },
      { status: 403 }
    )
  }

  return null
}
