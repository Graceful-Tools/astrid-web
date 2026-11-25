/**
 * Goal Signals access — the single place that answers "can this user use goal
 * signals?" (ADEV-269, docs/specs/GOALS_GUARDRAILS_SIGNALS.md → Gating).
 *
 * Two gates, checked in this order, and the order matters:
 *
 *   1. CAPABILITIES.goalSignals — build-time, per deployment, absolute, and
 *      requires Project Mode. No runtime flag can turn it back on.
 *   2. The `goal_signals` runtime flag — per user, admin-controlled.
 *
 * Never inline this pair at a call site. A deliberate copy of lib/task-cost.ts.
 */

import { NextResponse } from 'next/server'
import { CAPABILITIES } from '@/lib/brand/capabilities'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { GOAL_SIGNALS_FEATURE_KEY } from '@/lib/goal-signals-shared'

// Re-exported for server callers. Client components import it from
// lib/goal-signals-shared directly.
export { GOAL_SIGNALS_FEATURE_KEY }

/** Does this deployment ship Goal Signals at all? Build-time, no user involved. */
export function goalSignalsCompiledIn(): boolean {
  return CAPABILITIES.goalSignals
}

/** Can this user use goal signals right now? False, not an error, when the capability is off. */
export async function canUseGoalSignals(userId: string): Promise<boolean> {
  if (!goalSignalsCompiledIn()) return false
  return isFeatureEnabled(GOAL_SIGNALS_FEATURE_KEY, userId)
}

/**
 * Guard for goal-signals route handlers. Returns a Response to return
 * immediately, or null to continue.
 *   - capability off -> 404, the feature does not exist in this deployment.
 *   - flag off       -> 403 `not_granted`, which the client turns into the
 *     request-access affordance.
 */
export async function goalSignalsGate(userId: string): Promise<NextResponse | null> {
  if (!goalSignalsCompiledIn()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!(await isFeatureEnabled(GOAL_SIGNALS_FEATURE_KEY, userId))) {
    return NextResponse.json(
      {
        error: 'Goal signals are not enabled for this account',
        reason: 'not_granted',
        featureKey: GOAL_SIGNALS_FEATURE_KEY,
      },
      { status: 403 }
    )
  }

  return null
}
