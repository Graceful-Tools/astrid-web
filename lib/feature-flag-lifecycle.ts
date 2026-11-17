export const FEATURE_CACHE_TTL_MS = 15 * 60 * 1000

export function featureRefreshPolicy(input: {
  launchCount: number
  cacheUpdatedAt: number | null
  now: number
  ttlMs?: number
}): { shouldFetch: boolean; nextLaunchCount: number } {
  const nextLaunchCount = input.launchCount + 1
  // Skipping the first launch keeps startup light, but never when this account has no
  // flags at all: a new login would draw no gated UI (Projects) until a second launch (ADEV-73).
  if (input.launchCount === 0 && input.cacheUpdatedAt !== null) return { shouldFetch: false, nextLaunchCount }
  const ttl = input.ttlMs ?? FEATURE_CACHE_TTL_MS
  return {
    shouldFetch: input.cacheUpdatedAt === null || input.now - input.cacheUpdatedAt >= ttl,
    nextLaunchCount,
  }
}
