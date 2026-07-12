export const FEATURE_CACHE_TTL_MS = 15 * 60 * 1000

export function featureRefreshPolicy(input: {
  launchCount: number
  cacheUpdatedAt: number | null
  now: number
  ttlMs?: number
}): { shouldFetch: boolean; nextLaunchCount: number } {
  const nextLaunchCount = input.launchCount + 1
  if (input.launchCount === 0) return { shouldFetch: false, nextLaunchCount }
  const ttl = input.ttlMs ?? FEATURE_CACHE_TTL_MS
  return {
    shouldFetch: input.cacheUpdatedAt === null || input.now - input.cacheUpdatedAt >= ttl,
    nextLaunchCount,
  }
}
