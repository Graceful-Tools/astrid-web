/**
 * Client-safe Task Cost constants.
 *
 * Deliberately import-free, for the same reason as lib/project-mode-shared.ts:
 * lib/task-cost.ts reaches lib/feature-flags → lib/prisma, so a *value* import
 * of it from a client component drags the server stack into the browser bundle
 * and fails the build. Client code imports the key from here instead.
 */

export const TASK_COST_FEATURE_KEY = 'task_cost' as const
