"use client"

/**
 * Can the signed-in person use Goal Signals here? The client half of `canUseGoalSignals`
 * (lib/goal-signals.ts): the deployment ships it (`CAPABILITIES.goalSignals`) AND the person has the
 * `goal_signals` flag. The server enforces the same pair on every goal-signals route; this only
 * decides what to draw.
 */
import { CAPABILITIES } from '@/lib/brand/capabilities'
import { useFeatureFlags } from '@/contexts/feature-flag-context'
import { GOAL_SIGNALS_FEATURE_KEY } from '@/lib/goal-signals-shared'

export function useGoalSignals(): boolean {
  const { isEnabled } = useFeatureFlags()
  return CAPABILITIES.goalSignals && isEnabled(GOAL_SIGNALS_FEATURE_KEY)
}
