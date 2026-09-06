/**
 * When may a failed offline mutation be attempted again?
 *
 * OfflineSyncManager declared `retryDelay = 1000 // 1 second base delay` and
 * never read it (task b8b21855). A failed mutation went back on the queue as
 * 'pending', and a sync pass is triggered by the `online` event, by cross-tab
 * messages and by every queueMutation call — so the next pass could be
 * milliseconds later. Three of those in a row exhausted maxRetries without the
 * mutation ever having waited, which defeats the point: the common cause of a
 * failure is a network that has just come back and is not ready yet.
 */

/** Base delay, doubled per attempt. */
export const RETRY_BASE_DELAY_MS = 1000

/** Delay before attempt number `retryCount + 1`, i.e. after `retryCount` failures. */
export function retryBackoffMs(retryCount: number): number {
  const exponent = Math.max(0, retryCount - 1)
  return RETRY_BASE_DELAY_MS * 2 ** exponent
}

/**
 * A mutation with no recorded schedule is due: a first attempt must never be
 * delayed, or every offline edit would sit for a second before being sent.
 */
export function isDueForRetry(mutation: { nextAttemptAt?: number }, now: number): boolean {
  return mutation.nextAttemptAt === undefined || mutation.nextAttemptAt <= now
}
