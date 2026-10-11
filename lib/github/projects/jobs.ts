/**
 * The GitHub sync job queue's rules (AWTD-1152, P4d). Spec §8.1, §8.7.
 *
 * Pure, so fairness and backoff are table-tested; services/github-sync-jobs
 * does the claiming and running.
 *
 *   - Coalescing: a burst of edits to one item inside 2 seconds is one
 *     hydration — the dedupe key is the item plus its 2s bucket.
 *   - Fairness: round-robin by installation, at most 2 jobs per installation
 *     per drain, so one large org cannot starve the others (§8.1).
 *   - Backoff: 30s doubling to an hour; after MAX_ATTEMPTS a job is dead
 *     (done, with its error kept for inspection).
 */

export const COALESCE_WINDOW_MS = 2_000
export const PER_INSTALLATION_CONCURRENCY = 2
export const MAX_ATTEMPTS = 8
/** How long a claimed job is ours before another drainer may take it. */
export const LOCK_MS = 2 * 60_000

export type SyncJobKind = 'hydrate' | 'reconcile' | 'access' | 'writeback' | 'comment' | 'position' | 'agent_label'

export interface HydratePayload {
  itemNodeId: string
  projectNodeId: string
}

export interface ReconcilePayload {
  projectId: string
}

export interface AccessPayload {
  installationId: number
}

/** How often a bound project is reconciled when nothing else asks. */
export const RECONCILE_INTERVAL_MS = 60 * 60 * 1000

/** One reconcile per project per interval, however often it is asked for. */
export function reconcileDedupeKey(projectId: string, now: number): string {
  return `reconcile:${projectId}:${Math.floor(now / RECONCILE_INTERVAL_MS)}`
}

/** A burst of org membership events is one role refresh per 10 minutes. */
export function accessDedupeKey(installationId: number, now: number): string {
  return `access:${installationId}:${Math.floor(now / (10 * 60_000))}`
}

export function hydrateDedupeKey(itemNodeId: string, now: number): string {
  return `item:${itemNodeId}:${Math.floor(now / COALESCE_WINDOW_MS)}`
}

export function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3_600_000)
}

/**
 * Due jobs (oldest first) → the ones to run now: interleaved across
 * installations, no more than `perInstallation` each, at most `limit` in all.
 */
export function pickRoundRobin<T extends { installationId: number }>(
  due: readonly T[],
  limit: number,
  perInstallation = PER_INSTALLATION_CONCURRENCY,
): T[] {
  const queues = new Map<number, T[]>()
  for (const job of due) {
    const queue = queues.get(job.installationId) ?? []
    if (queue.length < perInstallation) queue.push(job)
    queues.set(job.installationId, queue)
  }

  const picked: T[] = []
  for (let round = 0; round < perInstallation && picked.length < limit; round++) {
    for (const queue of queues.values()) {
      if (picked.length >= limit) break
      if (queue[round]) picked.push(queue[round])
    }
  }
  return picked
}
