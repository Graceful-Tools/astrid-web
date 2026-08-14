/**
 * RED for task 070bddf8 — web writes leave the v1 list cache stale, so iOS
 * keeps serving a pre-change list set for up to the 5-minute TTL.
 *
 * A user's list set is cached under TWO keys:
 *   lists:user:<id>      read by GET /api/lists      (web)
 *   lists:user:<id>:v1   read by GET /api/v1/lists   (iOS)
 *
 * app/api/v1/lists/route.ts documents the contract in its own header: mutation
 * paths must invalidate "both this and the legacy cache key". Seventeen call
 * sites instead hand-rolled `RedisCache.del(RedisCache.keys.userLists(id))`,
 * which clears only the web key.
 *
 * The obvious fix — call the existing RedisCache.invalidate.userLists everywhere
 * — is wrong: that one also does a global `delPattern('members:list:*')`, so
 * every task update would wipe every list's member cache for every user. Hence
 * a helper that clears exactly the two keys and nothing global.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// tests/setup.ts mocks @/lib/redis globally, which is right for route tests but
// would mean this file tests the mock rather than the invalidator. Nothing
// connects at import time — the client is built lazily inside getRedisClient —
// so the real module is safe to load here.
const { RedisCache } = await vi.importActual<typeof import('@/lib/redis')>('@/lib/redis')

describe('RedisCache.invalidate.userListsAllVersions (task 070bddf8)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('clears BOTH the legacy and the v1 list-set keys', async () => {
    const del = vi.spyOn(RedisCache, 'del').mockResolvedValue(undefined)

    await RedisCache.invalidate.userListsAllVersions('user-1')

    const cleared = del.mock.calls.map(c => c[0])
    expect(cleared).toContain('lists:user:user-1')
    expect(cleared).toContain('lists:user:user-1:v1')
  })

  it('does not wipe any global cache', async () => {
    // The distinction from invalidate.userLists, which also clears
    // `members:list:*` for every list on the account.
    vi.spyOn(RedisCache, 'del').mockResolvedValue(undefined)
    const delPattern = vi.spyOn(RedisCache, 'delPattern').mockResolvedValue(undefined)

    await RedisCache.invalidate.userListsAllVersions('user-1')

    expect(delPattern).not.toHaveBeenCalled()
  })

  it('is best-effort — a Redis outage must not fail the write that triggered it', async () => {
    vi.spyOn(RedisCache, 'del').mockRejectedValue(new Error('redis down'))

    await expect(RedisCache.invalidate.userListsAllVersions('user-1')).resolves.toBeUndefined()
  })
})
