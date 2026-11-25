/**
 * Client-safe Goal Signals constants. Import-free for the same reason as
 * lib/task-cost-shared.ts: lib/goal-signals.ts reaches lib/feature-flags →
 * lib/prisma, which a client component must not import.
 */

export const GOAL_SIGNALS_FEATURE_KEY = 'goal_signals' as const
